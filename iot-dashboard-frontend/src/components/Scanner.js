import { Html5QrcodeScanner } from "html5-qrcode";
import { useEffect } from "react";

function Scanner({ onScan, onClose }) {

    useEffect(() => {

        const scanner = new Html5QrcodeScanner(
            "scanner",
            { fps: 10, qrbox: 250 },
            false
        );

        scanner.render((decodedText) => {
            onScan(decodedText);
            scanner.clear();
        });

        return () => {
            scanner.clear().catch(() => { });
        };
    }, [onScan]);

    return (
        <div className="scanner-modal">
            <div className="scanner-box">
                <div id="scanner"></div>
                <button onClick={onClose}>Close</button>
            </div>
        </div>
    );
}

export default Scanner;