import React, { useState } from "react";
import Scanner from "../../components/Scanner";
import { useNavigate } from "react-router-dom";
import { API } from "../../config/api";

const api = "/api";

const RegisterDevice = () => {
    const navigate = useNavigate();

    // const [form, setForm] = useState({
    //     mac: "",
    //     locationId: "",
    //     address: "",
    //     latitude: "",
    //     longitude: "",
    //     ipCameraMake: "",
    //     ipCameraIp: "",
    // });

    const [form, setForm] = useState({
        mac: "",
        deviceName: "",
        location: "",
        address: "",
        latitude: "",
        longitude: "",
        ipCameraMake: "",
        ipCameraIp: "",
    });


    const [status, setStatus] = useState("");
    const [showScanner, setShowScanner] = useState(false);

    const handleRegister = async (e) => {
        e.preventDefault();
        setStatus("");

        const token = localStorage.getItem("token");

        try {
            const res = await fetch(`${api}/${API.registerDevice}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    mac: form.mac.trim(),
                    deviceName: form.deviceName,
                    location: form.location,
                    address: form.address,
                    latitude: +form.latitude,
                    longitude: +form.longitude,
                    ipCamera: {
                        type: form.ipCameraMake,
                        ip: form.ipCameraIp,
                    },
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            setStatus("✅ Device registered");

            setForm({
                mac: "",
                deviceName: "",
                location: "",
                address: "",
                latitude: "",
                longitude: "",
                ipCameraMake: "",
                ipCameraIp: "",
            });
        } catch (err) {
            setStatus("❌ " + err.message);
        }
    };

    return (
        <div>
            <h2>📡 Register Device</h2>

            <form onSubmit={handleRegister} className="device-form-grid">
                <input
                    className="full-width"
                    placeholder="IP Address"
                    value={form.mac}
                    onChange={(e) =>
                        setForm({ ...form, mac: e.target.value })
                    }
                    required
                />

                <div className="location-id-row">
                    <input
                        placeholder="Device Name"
                        value={form.deviceName}
                        onChange={(e) =>
                            setForm({ ...form, deviceName: e.target.value })
                        }
                        required
                    />

                    <button type="button" onClick={() => setShowScanner(true)}>
                        📷
                    </button>
                </div>

                <select
                    value={form.location}
                    onChange={(e) =>
                        setForm({ ...form, location: e.target.value })
                    }
                >
                    <option value="" disabled>
                        Select location
                    </option>
                    <option value="GP">GP</option>
                    <option value="BLOCK">BLOCK</option>
                </select>

                <input
                    placeholder="Address"
                    value={form.address}
                    onChange={(e) =>
                        setForm({ ...form, address: e.target.value })
                    }
                    required
                />

                <input
                    placeholder="Latitude"
                    value={form.latitude}
                    onChange={(e) =>
                        setForm({ ...form, latitude: e.target.value })
                    }
                    required
                />

                <input
                    placeholder="Longitude"
                    value={form.longitude}
                    onChange={(e) =>
                        setForm({ ...form, longitude: e.target.value })
                    }
                    required
                />

                {/* <input
                    placeholder="Camera Make"
                    value={form.ipCameraMake}
                    onChange={(e) =>
                        setForm({ ...form, ipCameraMake: e.target.value })
                    }
                    // required
                /> */}

                {/* <input
                    placeholder="Camera IP"
                    value={form.ipCameraIp}
                    onChange={(e) =>
                        setForm({ ...form, ipCameraIp: e.target.value })
                    }
                    // required
                /> */}

                <button type="submit">Register Device</button>

                {status && <p>{status}</p>}
            </form>

            {showScanner && (
                <Scanner
                    onScan={(value) => {
                        setForm((prev) => ({ ...prev, location: value }));
                        setShowScanner(false);
                    }}
                    onClose={() => setShowScanner(false)}
                />
            )}

            <div style={{ display: 'inline-block', marginBottom: "15px", backgroundColor: 'white', color: 'black', padding: '5px' }}>
                <button onClick={() => navigate("/admin/registered-devices")}>
                    🖥 View Registered Devices
                </button>
            </div>
        </div>
    );
};

export default RegisterDevice;