//! Per-core CPU temperatures on Intel Macs, read from the System Management
//! Controller (the `TC<n>C` keys, one per core's digital thermal sensor).
//!
//! sysinfo only reads a few fixed SMC keys (CPU proximity, PECI package), and
//! `powermetrics` needs root; talking to the `AppleSMC` IOKit service works
//! for any user. Apple silicon has no such keys — its per-cluster sensors come
//! through sysinfo's IOHID backend instead.

// Compiled on every Mac so the layout tests run on Apple silicon CI, but only
// Intel Macs call it.
#![cfg_attr(not(target_arch = "x86_64"), allow(dead_code))]

use std::sync::Mutex;

use crate::metrics::CoreTemp;

type KernReturn = i32;
type IoObject = u32;

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOServiceMatching(name: *const std::ffi::c_char) -> *mut std::ffi::c_void;
    fn IOServiceGetMatchingService(main_port: u32, matching: *mut std::ffi::c_void) -> IoObject;
    fn IOServiceOpen(service: IoObject, owning_task: u32, kind: u32, connect: *mut IoObject) -> KernReturn;
    fn IOObjectRelease(object: IoObject) -> KernReturn;
    fn IOServiceClose(connect: IoObject) -> KernReturn;
    fn IOConnectCallStructMethod(
        connection: IoObject,
        selector: u32,
        input: *const std::ffi::c_void,
        input_size: usize,
        output: *mut std::ffi::c_void,
        output_size: *mut usize,
    ) -> KernReturn;
}

extern "C" {
    static mach_task_self_: u32;
}

/// `SMCKeyData_t` from Apple's (unpublished but long-stable) SMC interface;
/// 80 bytes with C layout.
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct KeyData {
    key: u32,
    vers: [u8; 6],
    /// `SMCKeyData_pLimitData_t`: u16 version, u16 length, 3 × u32 limits.
    p_limit: [u32; 4],
    key_info: KeyInfo,
    result: u8,
    status: u8,
    data8: u8,
    data32: u32,
    bytes: [u8; 32],
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct KeyInfo {
    data_size: u32,
    data_type: u32,
    data_attributes: u8,
}

const KERNEL_INDEX_SMC: u32 = 2;
const SMC_CMD_READ_BYTES: u8 = 5;
const SMC_CMD_READ_KEYINFO: u8 = 9;

struct CoreKey {
    key: u32,
    name: [u8; 4],
    /// From the probe's key-info call, so each later read is one IOKit call.
    info: KeyInfo,
}

struct Smc {
    connection: IoObject,
    /// Core keys that returned a plausible reading when probed.
    core_keys: Vec<CoreKey>,
}

enum State {
    Uninit,
    Ready(Smc),
    /// Probe failed; retried after `RETRY_AFTER` in case it was transient.
    Unavailable(std::time::Instant),
}

const RETRY_AFTER: std::time::Duration = std::time::Duration::from_secs(60);

static STATE: Mutex<State> = Mutex::new(State::Uninit);

fn fourcc(key: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*key)
}

fn call(connection: IoObject, input: &KeyData) -> Option<KeyData> {
    let mut output = KeyData::default();
    let mut size = std::mem::size_of::<KeyData>();
    let rc = unsafe {
        IOConnectCallStructMethod(
            connection,
            KERNEL_INDEX_SMC,
            input as *const KeyData as *const _,
            std::mem::size_of::<KeyData>(),
            &mut output as *mut KeyData as *mut _,
            &mut size,
        )
    };
    (rc == 0 && output.result == 0).then_some(output)
}

fn key_info(connection: IoObject, key: u32) -> Option<KeyInfo> {
    Some(call(connection, &KeyData { key, data8: SMC_CMD_READ_KEYINFO, ..Default::default() })?.key_info)
}

fn read_temperature(connection: IoObject, key: u32, info: KeyInfo) -> Option<f32> {
    let value = call(
        connection,
        &KeyData { key, data8: SMC_CMD_READ_BYTES, key_info: KeyInfo { data_size: info.data_size, ..Default::default() }, ..Default::default() },
    )?;
    decode_temperature(info.data_type, info.data_size, &value.bytes)
}

/// SMC temperatures are `sp78` (signed 8.8 fixed point) on Intel Macs;
/// `flt ` shows up on newer firmware.
pub fn decode_temperature(data_type: u32, size: u32, bytes: &[u8; 32]) -> Option<f32> {
    let celsius = match (&data_type.to_be_bytes(), size) {
        (b"sp78", 2) => i16::from_be_bytes([bytes[0], bytes[1]]) as f32 / 256.0,
        (b"flt ", 4) => f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
        _ => return None,
    };
    (celsius.is_finite() && celsius > 0.0 && celsius < 130.0).then_some(celsius)
}

fn open() -> Option<Smc> {
    unsafe {
        let service = IOServiceGetMatchingService(0, IOServiceMatching(c"AppleSMC".as_ptr()));
        if service == 0 {
            return None;
        }
        let mut connection: IoObject = 0;
        let rc = IOServiceOpen(service, mach_task_self_, 0, &mut connection);
        IOObjectRelease(service);
        if rc != 0 {
            return None;
        }
        // Probe TC0C…TCFC (and the lowercase `c` variants some models use)
        // once; later reads only touch keys that exist.
        let mut core_keys = Vec::new();
        for digit in b"0123456789ABCDEF" {
            for suffix in [b'C', b'c'] {
                let name = [b'T', b'C', *digit, suffix];
                let key = fourcc(&name);
                if let Some(info) = key_info(connection, key) {
                    if read_temperature(connection, key, info).is_some() {
                        core_keys.push(CoreKey { key, name, info });
                        break;
                    }
                }
            }
        }
        if core_keys.is_empty() {
            IOServiceClose(connection);
            return None;
        }
        Some(Smc { connection, core_keys })
    }
}

/// Per-core temperatures, in core order. Empty when the SMC can't be opened
/// or exposes no per-core keys.
pub fn core_temperatures() -> Vec<CoreTemp> {
    let mut state = STATE.lock().unwrap_or_else(|p| p.into_inner());
    let retry = match &*state {
        State::Uninit => true,
        State::Unavailable(since) => since.elapsed() >= RETRY_AFTER,
        State::Ready(_) => false,
    };
    if retry {
        *state = match open() {
            Some(smc) => State::Ready(smc),
            None => State::Unavailable(std::time::Instant::now()),
        };
    }
    let State::Ready(smc) = &*state else { return Vec::new() };
    smc.core_keys
        .iter()
        .filter_map(|k| {
            let celsius = read_temperature(smc.connection, k.key, k.info)?;
            let core = (k.name[2] as char).to_digit(16)?;
            Some(CoreTemp { label: format!("Core {core}"), celsius })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_data_matches_the_c_layout() {
        assert_eq!(std::mem::size_of::<KeyData>(), 80);
        assert_eq!(std::mem::offset_of!(KeyData, p_limit), 12);
        assert_eq!(std::mem::offset_of!(KeyData, key_info), 28);
        assert_eq!(std::mem::offset_of!(KeyData, data32), 44);
        assert_eq!(std::mem::offset_of!(KeyData, data8), 42);
        assert_eq!(std::mem::offset_of!(KeyData, bytes), 48);
    }

    #[test]
    fn decodes_sp78_and_float() {
        let mut bytes = [0u8; 32];
        bytes[0] = 52;
        bytes[1] = 128; // 52.5 °C
        assert_eq!(decode_temperature(fourcc(b"sp78"), 2, &bytes), Some(52.5));
        let f = 61.25f32.to_le_bytes();
        bytes[..4].copy_from_slice(&f);
        assert_eq!(decode_temperature(fourcc(b"flt "), 4, &bytes), Some(61.25));
        assert_eq!(decode_temperature(fourcc(b"ui8 "), 1, &bytes), None);
        assert_eq!(decode_temperature(fourcc(b"sp78"), 2, &[0u8; 32]), None);
    }
}
