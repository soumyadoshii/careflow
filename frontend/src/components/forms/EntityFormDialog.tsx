import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { X } from "lucide-react";
import { Button } from "../ui";

export interface EntityField {
  name: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "tel"
    | "date"
    | "time"
    | "number"
    | "password"
    | "select"
    | "textarea";
  required?: boolean;
  options?: { value: string; label: string }[];
  min?: number;
  step?: number;
  hint?: string;
}

export function EntityFormDialog({
  title,
  fields,
  initial = {},
  onClose,
  onSubmit,
  submitLabel = "Save changes",
}: {
  title: string;
  fields: EntityField[];
  initial?: Record<string, unknown>;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void> | void;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const normalized: Record<string, string> = {};
    fields.forEach((field) => {
      normalized[field.name] = String(initial[field.name] ?? "");
    });
    setValues(normalized);
  }, [initial, fields]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload: Record<string, unknown> = {};
    fields.forEach((field) => {
      const value = values[field.name] ?? "";
      payload[field.name] = field.type === "number" ? Number(value) : value;
    });
    try {
      await onSubmit(payload);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to save this record.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entity-modal-title"
      >
        <div className="modal-heading">
          <div>
            <h2 id="entity-modal-title">{title}</h2>
            <p>
              Fields marked with <span className="required-mark">*</span> are
              required.
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="entity-form">
          <div className="form-grid">
            {fields.map((field) => (
              <label
                className={`form-field ${field.type === "textarea" ? "field-wide" : ""}`}
                key={field.name}
              >
                <span>
                  {field.label}
                  {field.required && <span className="required-mark"> *</span>}
                </span>
                {field.type === "select" ? (
                  <select
                    required={field.required}
                    value={values[field.name] ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select {field.label.toLowerCase()}</option>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea
                    required={field.required}
                    rows={3}
                    value={values[field.name] ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }))
                    }
                  />
                ) : (
                  <input
                    type={field.type ?? "text"}
                    min={field.min}
                    step={field.step}
                    required={field.required}
                    value={values[field.name] ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }))
                    }
                  />
                )}
                {field.hint && <small>{field.hint}</small>}
              </label>
            ))}
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : submitLabel}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
