import React from "react";

const DeviceTile = React.memo(function DeviceTile({
    mac,
    locationId,
    status,
    isSelected,
    onClick,
}) {
    console.count(`🔷 Tile render: ${mac}`);

    return (
        <div
            className={`device-tile ${status} ${isSelected ? "selected" : ""}`}
            onClick={() => onClick(mac, locationId)}
        >
            {locationId || mac}
        </div>
    );
},

    (prev, next) => {
        return (
            prev.status === next.status &&
            prev.isSelected === next.isSelected &&
            prev.locationId === next.locationId
        );
    }

);

export default DeviceTile;