import React, { useState, useEffect } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import "../../App.css";

const AdminLayout = () => {
    const navigate = useNavigate();

    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const toggleSidebar = () => {
        if (isMobile) setSidebarOpen((prev) => !prev);
        else setSidebarCollapsed((prev) => !prev);
    };

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("role");
        navigate("/");
    };

    const role = localStorage.getItem("role")

    return (
        <div className={`admin-dashboard${sidebarCollapsed ? " collapsed" : ""}`}>
            {/* Mobile Hamburger */}
            {isMobile && (
                <button
                    className="collapse-toggle"
                    style={{ position: "fixed", left: 10, top: 10, zIndex: 1100 }}
                    onClick={() => setSidebarOpen((prev) => !prev)}
                >
                    ☰
                </button>
            )}

            {/* Backdrop */}
            {isMobile && sidebarOpen && (
                <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
            )}

            {/* Sidebar */}
            <aside
                className={`sidebar${sidebarCollapsed ? " collapsed" : ""}${isMobile ? (sidebarOpen ? " open" : "") : ""
                    }`}
                style={{
                    ...(isMobile ? { position: "fixed" } : {}),
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {!isMobile && (
                    <button className="collapse-toggle" onClick={toggleSidebar}>
                        {sidebarCollapsed ? "➡️" : "⬅️"}
                    </button>
                )}

                {!sidebarCollapsed && <h3>🛠 Admin Panel</h3>}

                <ul>
                    <li onClick={() => navigate("/admin/add-user")}>
                        👤 {sidebarCollapsed && !isMobile ? "" : "Users"}
                    </li>
                    {/* <li onClick={() => navigate("/admin/registered-users")}>
                        📋 {sidebarCollapsed && !isMobile ? "" : "Registered Users"}
                    </li> */}
                    <li onClick={() => navigate("/admin/register-device")}>
                        📡 {sidebarCollapsed && !isMobile ? "" : "Devices"}
                    </li>
                    {/* <li onClick={() => navigate("/admin/registered-devices")}>
                        🖥 {sidebarCollapsed && !isMobile ? "" : "Registered Devices"}
                    </li> */}
                    <li onClick={() => navigate("/admin/color-scheme")}>
                        🎨 {sidebarCollapsed && !isMobile ? "" : "Alarm Colors"}
                    </li>
                    <li onClick={() => navigate("/admin/dashboard")}>
                        📊 {sidebarCollapsed && !isMobile ? "" : "Console"}
                    </li>
                    <li onClick={() => navigate("/admin/historical-data")}>
                        📈 {sidebarCollapsed && !isMobile ? "" : "Historical Data"}
                    </li>
                </ul>

                {role === "field-worker" && (
                    <li onClick={() => navigate("/admin/register-device")}>
                        📡 {sidebarCollapsed && !isMobile ? "" : "Devices"}
                    </li>
                )}

                <ul style={{ marginTop: "auto" }}>
                    <li onClick={handleLogout}>
                        🚪 {sidebarCollapsed && !isMobile ? "" : "Logout"}
                    </li>
                </ul>
            </aside>

            {/* Main Content */}
            <main className="tab-content">
                <Outlet />
            </main>
        </div>
    );
};

export default AdminLayout;