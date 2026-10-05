import React, { useEffect, useRef, useState } from 'react';
import { resolveAddress, parseCommand } from '../../shared/url';

interface Props {
  open: boolean;
  initialValue?: string;
  onClose: () => void;
  onNavigate: (url: string) => void;
  onCommand: (cmd: string, args: string) => void;
}

export const Palette: React.FC<Props> = ({ open, initialValue, onClose, onNavigate, onCommand }) => {
  const [value, setValue] = useState(initialValue || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue || '');
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 10);
    }
  }, [open, initialValue]);

  if (!open) return null;

  const submit = () => {
    const s = value.trim();
    if (!s) {
      onClose();
      return;
    }
    const cmd = parseCommand(s);
    if (cmd.isCommand) {
      onCommand(cmd.cmd, cmd.args);
    } else {
      const { url } = resolveAddress(s);
      if (url) onNavigate(url);
    }
    onClose();
  };

  return (
    <div
      data-palette="true"
      data-ui-region="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '18vh',
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 640,
          maxWidth: '90vw',
          background: 'rgba(24,28,38,0.95)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          padding: 8,
        }}
      >
        <input
          ref={inputRef}
          data-palette="true"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Search or enter address…  (try: youtube.com  |  electron tutorial  |  >privacy)"
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#fff',
            fontSize: 18,
            padding: '14px 16px',
            borderRadius: 10,
          }}
        />
        <div style={{ padding: '6px 12px', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
          Enter = go · Esc = close · Prefix with &gt; for commands (privacy, freeze, clean, clear, fullscreen, settings, background)
        </div>
      </div>
    </div>
  );
};
