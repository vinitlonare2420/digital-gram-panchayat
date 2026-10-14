/* ==========================================================================
   validation.js — reusable client-side validators + inline error rendering.
   Every form on the site (login, register, the four certificate forms,
   track application) calls into these same functions so behaviour and
   messaging stay consistent.
   ========================================================================== */

const Validators = {
  required(value) {
    return value !== undefined && value !== null && String(value).trim() !== ''
      ? null : 'This field is required.';
  },
  email(value) {
    if (!value) return null;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(value.trim()) ? null : 'Enter a valid email address.';
  },
  mobile(value) {
    if (!value) return null;
    const re = /^[6-9]\d{9}$/;
    return re.test(value.trim()) ? null : 'Enter a valid 10-digit mobile number.';
  },
  minLength(value, len) {
    if (!value) return null;
    return value.length >= len ? null : `Must be at least ${len} characters.`;
  },
  password(value) {
    if (!value) return null;
    return value.length >= 8 ? null : 'Password must be at least 8 characters.';
  },
  matches(value, other, label = 'Values') {
    return value === other ? null : `${label} do not match.`;
  },
  notFutureDate(value) {
    if (!value) return null;
    const d = new Date(value);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return d <= today ? null : 'Date cannot be in the future.';
  },
  numeric(value) {
    if (!value) return null;
    return /^\d+(\.\d+)?$/.test(value) ? null : 'Enter a numeric value.';
  },
  maxLength(value, len) {
    if (!value) return null;
    return value.trim().length <= len ? null : `Must be ${len} characters or fewer.`;
  },
  integerBetween(value, min, max) {
    if (!value) return null;
    return /^\d+$/.test(value.trim()) && Number(value) >= min && Number(value) <= max
      ? null : `Enter a whole number between ${min} and ${max}.`;
  },
  /** value must be a date strictly before otherValue (both yyyy-mm-dd); otherwise `message`. */
  dateBefore(value, otherValue, message) {
    if (!value || !otherValue) return null;
    return new Date(value) < new Date(otherValue) ? null : message;
  },
};

/** Show an inline error message under a field. Expects a sibling <p data-error-for="fieldId"> */
function showFieldError(fieldId, message) {
  const input = document.getElementById(fieldId);
  const errorEl = document.querySelector(`[data-error-for="${fieldId}"]`);
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.classList.add('border-red-500', 'focus:outline-red-500');
    input.classList.remove('border-[var(--color-border)]');
  }
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }
}

/** Clear an inline error message for a field */
function clearFieldError(fieldId) {
  const input = document.getElementById(fieldId);
  const errorEl = document.querySelector(`[data-error-for="${fieldId}"]`);
  if (input) {
    input.removeAttribute('aria-invalid');
    input.classList.remove('border-red-500', 'focus:outline-red-500');
    input.classList.add('border-[var(--color-border)]');
  }
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }
}

/**
 * Validate a set of fields against rules.
 * rules: { fieldId: [ (value) => errorOrNull, ... ] }
 * Returns true if the whole form is valid; renders/clears inline errors as it goes.
 */
function validateFields(rules) {
  let isValid = true;
  let firstInvalidId = null;
  Object.entries(rules).forEach(([fieldId, validators]) => {
    const input = document.getElementById(fieldId);
    const value = input ? input.value : '';
    let error = null;
    for (const validate of validators) {
      error = validate(value);
      if (error) break;
    }
    if (error) {
      isValid = false;
      showFieldError(fieldId, error);
      if (!firstInvalidId) firstInvalidId = fieldId;
    } else {
      clearFieldError(fieldId);
    }
  });
  if (firstInvalidId) {
    const el = document.getElementById(firstInvalidId);
    if (el) el.focus();
  }
  return isValid;
}

/**
 * Validate a selected file against type + size constraints.
 * Returns null if valid, or an error string.
 */
function validateFile(file, { types = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'], maxSizeMB = 5 } = {}) {
  if (!file) return 'Please select a file.';
  if (!types.includes(file.type)) return 'Only PDF, JPG, JPEG or PNG files are allowed.';
  if (file.size > maxSizeMB * 1024 * 1024) return `File must be smaller than ${maxSizeMB} MB.`;
  return null;
}
