import React from 'react';
import './PasswordPrompt.css';

const PasswordPrompt = ({ onSubmit, onCancel, warningSign }) => {
  const [password, setPassword] = React.useState('');

  React.useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      onSubmit(password);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="password-modal-overlay">
      <div className="password-modal" role="dialog" aria-modal="true" aria-label="Admin password prompt">
        <h3>🔒 Enter Admin Password</h3>
        {warningSign && <p className="mt-3 text-red-500">{warningSign}</p>}
        <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); onSubmit(password); }}>
          <input
            className='text-black'
            type="password"
            name="admin-action-password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Admin password"
          />
          <div className="password-modal-buttons">
            <button type="submit">✅ Confirm</button>
            <button type="button" onClick={onCancel}>❌ Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PasswordPrompt;
