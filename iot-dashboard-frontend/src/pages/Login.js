import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';

const API = "/api";

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (res.ok && data.token) {
        // ✅ Store token and role in localStorage
        localStorage.setItem('token', data.token);
        localStorage.setItem('role', data.role);

        setStatus('Login successful');

        // ✅ Redirect based on role
        if (data.role === 'admin') {
          navigate('/admin');
        } else {
          navigate('/dashboard'); // your common dashboard route
        }
      } else {
        setStatus(data.error || 'Login failed');
      }
    } catch (err) {
      setStatus('Server error during login');
    }
  };

  return (
    <div className="login-container">
      <h2>🔐 Login</h2>
      <form onSubmit={handleLogin}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          required
          maxLength={20}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          maxLength={20}
        />
        <button type="submit">Login</button>
        <p>{status}</p>
      </form>
    </div>
  );
}

export default Login;

