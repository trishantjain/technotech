import React, { useEffect, useState } from "react";
import PasswordPrompt from "../../components/PasswordPrompt";
import { useNavigate } from "react-router-dom";

const API = "/api";

const RegisteredUsers = () => {
    const navigate = useNavigate();

    const [users, setUsers] = useState([]);
    const [showPrompt, setShowPrompt] = useState(false);
    const [pendingAction, setPendingAction] = useState(null);

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

    const requestPassword = (callback) => {
        setPendingAction(() => callback);
        setShowPrompt(true);
    };

    const handleEdit = (user, newUsername, newPassword) => {
        requestPassword(async (adminPassword) => {
            try {
                const res = await fetch(`${API}/user/${user._id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        username: newUsername,
                        password: newPassword,
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
        });
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
                    }}
                    onCancel={() => setShowPrompt(false)}
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

            <td>{user.role}</td>

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
                                onEdit(user, formData.username, formData.password);
                                setEditMode(false);
                            }}
                        >
                            💾 Save
                        </button>
                    </>
                ) : (
                    <button onClick={() => setEditMode(true)}>✏️ Edit</button>
                )}
            </td>

            <td>
                <button onClick={() => onDelete(user)}>❌ Delete</button>
            </td>
        </tr>
    );
};

export default RegisteredUsers;