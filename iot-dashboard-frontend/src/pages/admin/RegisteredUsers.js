import React, { useEffect, useState } from "react";
import Spinner from "../../components/Spinner";
import PasswordPrompt from "../../components/PasswordPrompt";
import { useNavigate } from "react-router-dom";

const API = "/api";

const RegisteredUsers = () => {
    const navigate = useNavigate();

    const [users, setUsers] = useState([]);
    const [showPrompt, setShowPrompt] = useState(false);
    const [pendingAction, setPendingAction] = useState(null);
    const [promptWarning, setPromptWarning] = useState("");
    const [loadingUsers, setLoadingUsers] = useState(false);

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            setLoadingUsers(true);

            const res = await fetch(`${API}/users`);
            const data = await res.json();
            setUsers(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingUsers(false);
        }
    };

    const requestPassword = (callback, warningText = "") => {
        setPendingAction(() => callback);
        setPromptWarning(warningText);
        setShowPrompt(true);
    };

    const handleEdit = (user, newUsername, newRole, newPassword) => {
        requestPassword(async (adminPassword) => {
            try {
                const res = await fetch(`${API}/user/${user._id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        username: newUsername,
                        password: newPassword,
                        role: newRole,
                        adminPassword,
                    }),
                });

                if (!res.ok) throw new Error("Update failed");
                fetchUsers();
            } catch (err) {
                alert(err.message);
            }
        });
    };

    const handleDelete = (user) => {
        if (user.role === "admin") return alert("Cannot delete admin");

        requestPassword(async (adminPassword) => {
            try {
                const res = await fetch(`${API}/user/${user.username}`, {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ adminPassword }),
                });

                if (!res.ok) throw new Error("Delete failed");
                fetchUsers();
            } catch (err) {
                alert(err.message);
            }
        }, "DELELTED USER CANNOT BE RETRIEVED");
    };

    return (
        <div>
            <div style={{ marginBottom: "15px" }}>
                <button onClick={() => navigate("/admin/add-user")}>
                    ➕ Add New User
                </button>
            </div>

            <h2>📋 Registered Users</h2>

            <table className="device-table">
                <thead>
                    <tr>
                        <th>Username</th>
                        <th>Role</th>
                        <th>Edit</th>
                        <th>Delete</th>
                    </tr>
                </thead>

                <tbody>
                    {loadingUsers ? (
                        <tr>
                            <td colSpan="8" style={{ textAlign: "center", padding: "30px" }}>
                                <Spinner />
                            </td>
                        </tr>
                    ) :
                        users.map((user) => (
                            <UserRow
                                key={user._id}
                                user={user}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                            />
                        ))
                    }
                </tbody>
            </table>

            {showPrompt && (
                <PasswordPrompt
                    onSubmit={(password) => {
                        pendingAction(password);
                        setShowPrompt(false);
                        setPromptWarning("");
                    }}
                    onCancel={() => {
                        setShowPrompt(false);
                        setPromptWarning("");
                    }}
                    warningSign={promptWarning}
                />
            )}
        </div>
    );
};

const UserRow = ({ user, onEdit, onDelete }) => {
    const [editMode, setEditMode] = useState(false);
    const [formData, setFormData] = useState({
        username: user.username,
        password: "",
        role: user.role
    });

    return (
        <tr>
            <td>
                {editMode ? (
                    <input
                        className="text-black"
                        value={formData.username}
                        onChange={(e) =>
                            setFormData({ ...formData, username: e.target.value })
                        }
                    />
                ) : (
                    user.username
                )}
            </td>

            <td>
                {editMode ? (
                    <select
                        className="text-black"
                        value={formData.role}
                        onChange={(e) =>
                            setFormData({ ...formData, role: e.target.value })
                        }
                    >
                        <option value="admin">Admin</option>
                        <option value="block">Block Officer</option>
                        <option value="gp">GP Officer</option>
                        <option value="user">Common User</option>
                        <option value="field-worker">Field Worker</option>
                    </select>
                ) : (
                    user.role
                )}
            </td>

            {/* <td>{user.role}</td> */}

            <td>
                {editMode ? (
                    <>
                        <input
                            className="text-black"
                            type="password"
                            placeholder="New password"
                            onChange={(e) =>
                                setFormData({ ...formData, password: e.target.value })
                            }
                        />
                        <button
                            onClick={() => {
                                onEdit(user, formData.username, formData.role, formData.password);
                                setEditMode(false);
                            }}
                        >
                            💾 Save
                        </button>
                    </>
                ) : (
                    <button onClick={() => setEditMode(true)} className="p-1 text-black bg-gray-200 rounded-md">✏️ Edit</button>
                )}
            </td>

            <td>
                <button onClick={() => onDelete(user)} className="p-1 text-black bg-gray-200 rounded-md">❌ Delete</button>
            </td>
        </tr>
    );
};

export default RegisteredUsers;