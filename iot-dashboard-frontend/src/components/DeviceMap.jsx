import React, { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";

const defaultLocation = [28.6139, 77.209];

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

const DeviceMap = React.memo(function DeviceMap({
    deviceMeta,
    deviceStatusMap,
    selectedMac,
    onMarkerClick
}) {
    console.log("Rendering DeviceMap");

    // ✅ memoized center
    const selectedCenter = useMemo(() => {
        const selectedDevice = deviceMeta.find(d => d.mac === selectedMac);
        const lat = parseFloat(selectedDevice?.latitude);
        const lon = parseFloat(selectedDevice?.longitude);
        return !isNaN(lat) && !isNaN(lon)
            ? [lat, lon]
            : defaultLocation;
    }, [deviceMeta, selectedMac]);



    // ✅ memoize markers (IMPORTANT for performance)
    const markers = useMemo(() => {
        return deviceMeta.map(device => {
            const { mac } = device;

            const dotClass = deviceStatusMap[mac] || "disconnected";

            const icon = L.divIcon({
                className: "custom-marker",
                html: `<div class="marker-dot ${dotClass}"></div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10],
            });

            const lat = parseFloat(device.latitude);
            const lon = parseFloat(device.longitude);
            if (isNaN(lat) || isNaN(lon)) return null;

            return (
                <Marker
                    key={mac}
                    position={[lat, lon]}
                    icon={icon}
                    // eventHandlers={{
                    //     hover: () => onMarkerClick(mac),
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
                        {device.locationId || mac} <br />
                        {device.address}
                    </Popup>
                </Marker>
            );
        });
    }, [deviceMeta, deviceStatusMap, onMarkerClick]);


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

            {markers}
        </MapContainer>
    );
});

export default DeviceMap;