import React from "react";
import DeviceTile from "./DeviceTile";
import Spinner from "./Spinner";


const DevicePanel = React.memo(function DevicePanel({
    deviceMeta,
    deviceStatusMap,
    selectedMac,
    onSelectDevice,
    connectedCount,
    statusFilter,
    setStatusFilter,
    searchTerm,
    setSearchTerm,
    filteredDevices,
    loading
}) {
    console.log("📦 DevicePanel render");

    return (
        <>
            <div className="device-panel-header">
                <div className="device-counts">
                    <div
                        className={`count connected ${statusFilter === "connected" ? "active-filter" : ""}`}
                        onClick={() => setStatusFilter("connected")}
                    >
                        Healthy: {connectedCount.connected}
                    </div>
                    <div
                        className={`count status-alarm ${statusFilter === "status-alarm" ? "active-filter" : ""}`}
                        onClick={() => setStatusFilter("status-alarm")}
                    >
                        Status: {connectedCount.statusAlarm}
                    </div>

                    <div
                        className={`count gauge-alarm ${statusFilter === "gauge-alarm" ? "active-filter" : ""}`}
                        onClick={() => setStatusFilter("gauge-alarm")}
                    >
                        Gauge: {connectedCount.gaugeAlarm}
                    </div>
                    <div
                        className={`count disconnected ${statusFilter === "disconnected" ? "active-filter" : ""}`}
                        onClick={() => setStatusFilter("disconnected")}
                    >
                        Disconnected: {connectedCount.disconnected}
                    </div>
                    <div
                        className={`count total ${statusFilter === "all" ? "active-filter" : ""}`}
                        onClick={() => setStatusFilter("all")}
                    >
                        Total: {connectedCount.total}
                    </div>
                </div>

                <div className="device-search">
                    <input
                        type="text"
                        placeholder="🔍 Search by Address or IP..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        autoComplete="off"
                        name="device-search"
                    />
                </div>
            </div>

            {/* <div style={{ "display": "inline" }}>
                Device List: {connectedCount.total}
            </div> */}
            <div className="device-list-wrapper">
                {loading ? (
                    <div className="device-loading">
                        <Spinner size={50} />
                    </div>
                ) : (<div className="grid">
                    {filteredDevices.map((device) => {
                        const { mac, locationId } = device;

                        const status = deviceStatusMap[mac] || "disconnected";

                        return (
                            <DeviceTile
                                key={mac}
                                mac={mac}
                                locationId={locationId}
                                status={status}
                                isSelected={selectedMac === mac}
                                onClick={onSelectDevice}
                            />
                        );
                    })}
                </div>)}
            </div>
        </>
    )
});

export default DevicePanel;