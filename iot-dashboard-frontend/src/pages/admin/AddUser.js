import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import '../../App.css'

const API = "/api";

const AddUser = () => {
    const navigate = useNavigate();

    const [form, setForm] = useState({
        username: "",
        password: "",
        role: "block",
    });

    const [status, setStatus] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus("");

        try {
            const res = await fetch(`${API}/register-user`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed");

            setStatus("✅ User registered");
            setForm({ username: "", password: "", role: "block" });
        } catch (err) {
            setStatus("❌ " + err.message);
        }
    };

    return (
        <div>
            <h2>👤 Add User</h2>

            <form onSubmit={handleSubmit} className="text-black admin-form">
                <input
                    type="text"
                    placeholder="Username"
                    value={form.username}
                    onChange={(e) =>
                        setForm({ ...form, username: e.target.value })
                    }
                    required
                />

                <input
                    type="password"
                    placeholder="Password"
                    value={form.password}
                    onChange={(e) =>
                        setForm({ ...form, password: e.target.value })
                    }
                    required
                />

                <select
                    value={form.role}
                    onChange={(e) =>
                        setForm({ ...form, role: e.target.value })
                    }
                >
                    <option value="admin">Admin</option>
                    <option value="block">Block Officer</option>
                    <option value="gp">GP Officer</option>
                    <option value="user">Common User</option>
                    <option value="field-worker">Field Worker</option>
                </select>

                <button type="submit" className="font-bold text-white bg-sky-500 hover:bg-sky-600">Register</button>

                <div className="text-white">
                    {status && <p>{status}</p>}
                </div>
            </form>

            <div style={{ display: 'inline-block', marginBottom: "15px", backgroundColor: 'white', color: 'black', padding: '5px' }}>
                <button onClick={() => navigate("/admin/registered-users")}>
                    📋 View Registered Users
                </button>
            </div>
        </div>
    );
};

export default AddUser;