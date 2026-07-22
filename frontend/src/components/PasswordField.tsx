import { useState } from 'react'

interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
}

export function PasswordField({ id, label, value, onChange, autoComplete }: Props) {
  const [visible, setVisible] = useState(false)

  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={visible ? 'パスワードを非表示にする' : 'パスワードを表示する'}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3l18 18" strokeLinecap="round" />
              <path
                d="M10.58 10.58a2 2 0 0 0 2.83 2.83M9.36 5.11A10.94 10.94 0 0 1 12 5c6 0 10 6 10 6a17.6 17.6 0 0 1-3.11 3.94M6.11 6.11A17.9 17.9 0 0 0 2 11s4 6 10 6a10.6 10.6 0 0 0 4.24-.87"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path
                d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </>
  )
}
