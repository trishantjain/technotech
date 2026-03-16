import { Html5QrcodeScanner } from "html5-qrcode";
import { useEffect } from "react";

function Scanner({ onScan, onClose }) {

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const size = Math.min(220, Math.max(150, Math.floor(window.innerWidth * 0.55)));

        const scanner = new Html5QrcodeScanner(
            "scanner",
            {
                fps: 10,
                qrbox: { width: size, height: size },
                rememberLastUsedCamera: true,
                supportedScanTypes: [0,1]
            },
            false
        );


        scanner.render(
            (decodedText) => {
                onScan(decodedText);
                scanner.clear();
                onClose();
            },
            () => { }
        );
        return () => {
            document.body.style.overflow = previousOverflow;
            scanner.clear().catch(() => { });
        };
    }, [onScan]);

    return (
        <div className="scanner-modal">
            <div className="scanner-box">
                <div id="scanner"></div>
                <button className="scanner-close-btn" onClick={onClose}>Close</button>
            </div>
        </div>
    );
}

export default Scanner;