import React from "react";

const DeviceTile = React.memo(function DeviceTile({
    ip,
    deviceName,
    status,
    isSelected,
    onClick,
}) {
    const device = deviceName || ip;
    const truncatedDeviceName =
        device && device.length > 15
            ? `${device.slice(0, 15)}...`
            : device;

    return (
        <div
            className={`device-tile ${status} ${isSelected ? "selected" : ""}`}
            title={device}
            onClick={() => onClick(ip, deviceName)}
        >
            {truncatedDeviceName}
        </div>
    );
},

    (prev, next) => {
        return (
            prev.status === next.status &&
            prev.isSelected === next.isSelected &&
            prev.deviceName === next.deviceName
        );
    }

);

export default DeviceTile;