import React from "react";
import DeviceTile from "./DeviceTile";


const DevicePanel = React.memo(function DevicePanel({
    deviceMeta,
    deviceStatusMap,
    selectedMac,
    onSelectDevice,
    connectedCount
}) {
    console.log("📦 DevicePanel render");

    return (
        <>
            <div style={{ "display": "inline" }}>
                Device List: {connectedCount}
            </div>
            <div className="grid">
                {deviceMeta.map((device) => {
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
            </div>
        </>
    )
});

export default DevicePanel;