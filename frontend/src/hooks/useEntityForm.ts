import { useState, useCallback, useRef, useMemo } from 'react';
import i18n from '../services/i18n/i18n';

export interface FieldRule<T> {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  patternMessage?: string;
  validate?: (value: string, allValues: T) => string | null;
}

export interface FieldDef<T, K extends keyof T = keyof T> {
  name: K;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'number' | 'select' | 'password';
  placeholder?: string;
  required?: boolean;
  rules?: FieldRule<T>;
  options?: { value: string; label: string }[];
  section?: string;
  autoFocus?: boolean;
}

export interface FormSection {
  title: string;
  fields: string[];
}

interface UseEntityFormOptions<T extends Record<string, any>> {
  initial?: Partial<T>;
  fields: FieldDef<T>[];
  sections: FormSection[];
  onSubmit: (values: T) => Promise<void>;
  onSuccess?: () => void;
}

export interface FormErrors {
  [key: string]: string | null;
}

export function useEntityForm<T extends Record<string, any>>({
  initial, fields, sections: _sections, onSubmit, onSuccess,
}: UseEntityFormOptions<T>) {
  const buildInitial = useCallback(() => {
    const obj: Record<string, unknown> = {};
    for (const f of fields) {
      obj[f.name as string] = initial?.[f.name] ?? '';
    }
    return obj as T;
  }, [fields, initial]);

  const [values, setValues] = useState<T>(buildInitial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fieldMap = useMemo(() => {
    const map = new Map<keyof T, FieldDef<T>>();
    for (const f of fields) map.set(f.name, f);
    return map;
  }, [fields]);

  const validateField = useCallback((name: keyof T, value: string): string | null => {
    const def = fieldMap.get(name);
    if (!def) return null;

    if (def.required && !value.trim()) {
      return i18n.t('form.validation.required');
    }
    if (def.rules) {
      const r = def.rules;
      // minLength ne doit s'appliquer QUE quand il y a réellement une valeur :
      // un champ OPTIONNEL laissé vide ('' → longueur 0) ne doit jamais être
      // bloqué par une règle de longueur minimale (ex. vin obligatoire en
      // création, mais optionnel en édition — le formulaire était impossible
      // à valider en mode édition sans ressaisir le champ).
      if (r.minLength && value.length < r.minLength && (def.required || value.trim().length > 0)) {
        return i18n.t('form.validation.minLength', { min: r.minLength });
      }
      if (r.maxLength && value.length > r.maxLength) {
        return i18n.t('form.validation.maxLength', { max: r.maxLength });
      }
      if (r.pattern && value && !r.pattern.test(value)) {
        return r.patternMessage || i18n.t('form.validation.invalidFormat');
      }
      if (r.validate) {
        return r.validate(value, values);
      }
    }
    if (def.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return i18n.t('form.validation.invalidEmail');
    }
    if (def.type === 'tel' && value && !/^0[1-9][0-9]{8}$/.test(value.replace(/[\s.-]/g, ''))) {
      return i18n.t('form.validation.invalidPhone');
    }
    return null;
  }, [fieldMap, values]);

  const setValue = useCallback((name: keyof T, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    if (touched.has(name as string)) {
      setErrors((prev) => ({ ...prev, [name as string]: validateField(name, value) }));
    }
  }, [touched, validateField]);

  const handleBlur = useCallback((name: keyof T) => {
    setTouched((prev) => new Set(prev).add(name as string));
    setErrors((prev) => ({ ...prev, [name as string]: validateField(name, values[name] as string) }));
  }, [validateField, values]);

  const isValid = useMemo(() => {
    for (const f of fields) {
      if (f.required && !(values[f.name] as string)?.trim()) return false;
      const err = validateField(f.name, values[f.name] as string);
      if (err) return false;
    }
    return true;
  }, [fields, values, validateField]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();

    const allTouched = new Set<string>();
    const newErrors: FormErrors = {};
    for (const f of fields) {
      const name = f.name as string;
      allTouched.add(name);
      newErrors[name] = validateField(f.name, values[f.name] as string);
    }
    setTouched(allTouched);
    setErrors(newErrors);

    const hasError = Object.values(newErrors).some(Boolean);
    if (hasError) {
      if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        const fieldsInError = Object.entries(newErrors)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: "${v}"`);
        console.warn(
          `[useEntityForm] Validation échouée — ${fieldsInError.length} champ(s) en erreur :\n` +
          fieldsInError.join('\n') +
          '\nVérifier que chaque champ requis a bien son erreur affichée dans le JSX.',
        );
      }
      return;
    }

    setSaving(true);
    setServerError(null);
    try {
      await onSubmit(values);
      if (mountedRef.current) {
        onSuccess?.();
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        const apiErr = err as { response?: { data?: { message?: string | string[] } }; userMessage?: string; message?: string };
        const msg = apiErr?.response?.data?.message;
        setServerError(Array.isArray(msg) ? msg[0] : (msg || apiErr?.userMessage || apiErr?.message || i18n.t('common.saveError')));
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [fields, validateField, values, onSubmit, onSuccess]);

  const reset = useCallback(() => {
    setValues(buildInitial());
    setErrors({});
    setTouched(new Set());
    setServerError(null);
    setSaving(false);
  }, [buildInitial]);

  return {
    values, setValue, errors, touched, saving, serverError,
    isValid, handleSubmit, handleBlur, reset,
  };
}
