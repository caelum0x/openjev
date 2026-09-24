use std::ffi::{CStr, CString};
use std::os::raw::c_char;

extern "C" {
    fn openjev_eval_dup(json: *const c_char) -> *mut c_char;
    fn openjev_free(p: *mut c_char);
    fn openjev_version() -> *const c_char;
}

pub fn eval_json(input: &str) -> Result<String, String> {
    let c = CString::new(input).map_err(|e| e.to_string())?;
    unsafe {
        let p = openjev_eval_dup(c.as_ptr());
        if p.is_null() {
            return Err("openjev_eval_dup returned null".into());
        }
        let s = CStr::from_ptr(p).to_string_lossy().into_owned();
        openjev_free(p);
        Ok(s)
    }
}

pub fn version() -> String {
    unsafe {
        let p = openjev_version();
        if p.is_null() {
            return "unknown".into();
        }
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}
