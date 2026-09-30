import React, { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";

const defaultLocation = [28.6139, 77.209];

const iconCache = {};

function getIcon(status) {
    if (!iconCache[status]) {
        iconCache[status] = L.divIcon({
            className: "custom-marker",
            html: `<div class="marker-dot ${status}"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
        });
    }
    return iconCache[status];
}

// FUNCTION TO MOVE FROM ONE LOCATION TO ANOTHER
function FlyToLocation({ center, zoom }) {
    const map = useMap();

    useEffect(() => {
        if (center) {
            map.flyTo(center, zoom ?? map.getZoom(), { duration: 1.2 });
        }
    }, [center, zoom, map]);

    return null;
}

const DeviceMarker = React.memo(function DeviceMarker({
    device,
    status,
}) {
    const { ip } = device;

    const lat = parseFloat(device.latitude);
    const lon = parseFloat(device.longitude);

    if (isNaN(lat) || isNaN(lon)) return null;

    const icon = getIcon(status);

    // console.log("Rendering Marker:", ip); // 🔥 debug

    return (
        <Marker
            position={[lat, lon]}
            icon={icon}
            eventHandlers={{
                mouseover: (e) => e.target.openPopup(),
                mouseout: (e) => e.target.closePopup(),
            }}
        >
            <Popup>
                {device.locationId || ip} <br />
                {device.address}
            </Popup>
        </Marker>
    );
});
const MarkersLayer = React.memo(({ markers }) => {
    return <>{markers}</>;
});

const DeviceMap = React.memo(function DeviceMap({
    deviceMeta,
    deviceStatusMap,
    selectedMac,
    onMarkerClick
}) {
    // console.log("Rendering DeviceMap");

    // ✅ memoized center
    const selectedCenter = useMemo(() => {
        const selectedDevice = deviceMeta.find(d => d.ip === selectedMac);
        const lat = parseFloat(selectedDevice?.latitude);
        const lon = parseFloat(selectedDevice?.longitude);
        return !isNaN(lat) && !isNaN(lon)
            ? [lat, lon]
            : defaultLocation;
    }, [deviceMeta, selectedMac]);



    // ✅ memoize markers (IMPORTANT for performance)
    const markers = useMemo(() => {
        return deviceMeta.map(device => {
            const { ip } = device;

            const dotClass = deviceStatusMap[ip] || "disconnected";

            const icon = getIcon(dotClass);

            const lat = parseFloat(device.latitude);
            const lon = parseFloat(device.longitude);
            if (isNaN(lat) || isNaN(lon)) return null;

            return (
                <Marker
                    key={ip}
                    position={[lat, lon]}
                    icon={icon}
                    // eventHandlers={{
                    //     hover: () => onMarkerClick(ip),
                    // }}
                    eventHandlers={{
                        mouseover: (e) => {
                            e.target.openPopup();
                        },
                        mouseout: (e) => {
                            e.target.closePopup();
                        },
                    }}
                >
                    <Popup>
                        {device.locationId || ip} <br />
                        {device.address}
                    </Popup>
                </Marker>
            );
        });
        // eslint-disable-next-line
        // }, [deviceMeta, deviceStatusMap, onMarkerClick]);
    }, [deviceMeta, deviceStatusMap]);


    return (
        <MapContainer
            key="device-map"
            center={selectedCenter}
            zoom={14}
            scrollWheelZoom={true}
            style={{ height: "315px", width: "100%" }}
        >
            <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            // attribution="&copy; OpenStreetMap & CartoDB"
            // subdomains="abcd"

            />

            <FlyToLocation center={selectedCenter} zoom={17} />

            {deviceMeta.map(device => (
                <DeviceMarker
                    key={device.ip}
                    device={device}
                    status={deviceStatusMap[device.ip]}
                />
            ))}
            {/* {markers} */}
        </MapContainer>
    );
});

export default DeviceMap;