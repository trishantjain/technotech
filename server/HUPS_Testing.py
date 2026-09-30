import serial
import sys
import binascii
import re
import threading


def send_manual_commands(ser):
    while True:
        try:
            command = input()

            if not command:
                continue

            # Automatically add # if missing
            if not command.startswith("#"):
                command = "#" + command

            # Automatically add $ if missing
            if not command.endswith("$"):
                command = command + "$"

            ser.write(command.encode("ascii"))

            print(f"\n📤 Command Sent: {command}")

        except Exception as e:
            print(f"\n❌ Command send error: {e}")
            break

# ============================================================
# DICT STORING REGISTER NUMBER OF HUPS & ITS VALUE [IN HEX]
# EXISTING BINARY MODBUS LOGIC
# ============================================================

register_values = {

    # MPPT ALARM
    "0190": "0100",  # [0001] 1 - working, [0000] 0 - alarm

    # OVERLOAD ALARM
    "0188": "0000",  # [0001] 1 - working, [0000] 0 - alarm

    # MAINS ALARM
    "0180": "0001",  # [0001] 1 - working, [0000] 0 - alarm

    # HUPS - FR FAIL
    # EMS - RECTIFIER ALARM
    "0186": "0010",  # [0001] 1 - working, [0000] 0 - alarm

    "0786": "0005",  # Fujiyama Battery Backup

    "0672": "0383",  # Fujiyama Battery SOC


    "0798": "0833",  # Fujiyama Inverter

    "0377": "0014",

    # BAT VOLT
    "021C": "000C",  # 12V

    # LOAD CURRENT
    "021E": "125C",

    # HUPS - MPPT 1 OUTPUT VOLT
    # EMS - OUTPUT VOLTAGE
    "024E": "1518",  # 10mV

    # HUPS - MPPT 1 INPUT VOLT
    # EMS - INPUT VOLTAGE
    "0256": "125C",  # 4700
}


def print_unsolicited_data(data):
    try:
        ascii_data = data.decode("ascii", errors="replace")

        print("\n================================")
        print("UNSOLICITED DATA RECEIVED")
        print(f"HEX  : {data.hex().upper()}")
        print(f"ASCII: {ascii_data}")
        print("================================\n")

    except Exception as e:
        print(f"Error printing unsolicited data: {e}")

# ============================================================
# MODBUS CRC
# EXISTING FUNCTION
# ============================================================


def modbus_crc16(data: bytes) -> int:

    crc = 0xFFFF

    for byte in data:

        crc ^= byte

        for _ in range(8):

            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1

    reversed_checksum = (
        ((crc & 0xFF) << 8)
        | ((crc >> 8) & 0xFF)
    )

    return reversed_checksum


# ============================================================
# SERIAL COMMUNICATION
# ============================================================

def read_serial_as_hex(
    port: str,
    baudrate: int = 9600,
    timeout: float = 1.0
):

    try:

        # Open serial port
        with serial.Serial(
            port,
            baudrate,
            timeout=timeout
        ) as ser:

            print(
                f"Connected to {port} at {baudrate} baud."
            )

            print(
                "Waiting for Binary Modbus packets "
                "and ASCII responses..."
            )

            print("Press Ctrl+C to stop.\n")

            print("Type a command and press Enter to send.")

            print("Example: #H41820005$\n")

            input_thread = threading.Thread(
                target=send_manual_commands,
                args=(ser,),
                daemon=True
            )

            input_thread.start()

            # ====================================================
            # EXISTING BINARY MODBUS BUFFER
            # ====================================================

            binary_buffer = bytearray()

            # ====================================================
            # ASCII RESPONSE BUFFER
            #
            # Response example:
            # #H41820A00E4000101F3000101F0$
            # ====================================================

            ascii_buffer = bytearray()

            receiving_ascii_packet = False

            while True:

                # Read one byte at a time
                # Read available incoming data
                data = ser.read(ser.in_waiting or 1)

                if not data:
                    continue

                # ====================================================
                # PRINT RAW INCOMING DATA BEFORE ANY COMPARISON
                # ====================================================

                # print("\n📥 RAW DATA RECEIVED")
                # print(f"HEX  : {data.hex().upper()}")
                # print(f"ASCII: {data.decode('ascii', errors='replace')}")
                # ====================================================
                # ASCII RESPONSE DETECTION
                #
                # Starts with #
                # Ends with $
                #
                # We only RECEIVE this response.
                # We do NOT send any ASCII response.
                # ====================================================

                # Start of ASCII packet
                if data == b"#":

                    receiving_ascii_packet = True

                    ascii_buffer = bytearray()

                    ascii_buffer.extend(data)

                    continue

                # Continue collecting ASCII response
                if receiving_ascii_packet:

                    ascii_buffer.extend(data)

                    # End of ASCII response
                    if data == b"$":

                        try:

                            ascii_response = ascii_buffer.decode(
                                "ascii",
                                errors="ignore"
                            )

                            print(
                                "\n================================"
                            )

                            print(
                                "ASCII RESPONSE RECEIVED"
                            )

                            print(
                                f"Response: {ascii_response}"
                            )

                            print(
                                "================================\n"
                            )

                        except Exception as e:

                            print(
                                f"ASCII response error: {e}"
                            )

                        # Reset ASCII buffer
                        ascii_buffer = bytearray()

                        receiving_ascii_packet = False

                    # Do not process ASCII bytes
                    # in binary Modbus logic
                    continue

                # ====================================================
                # EXISTING BINARY MODBUS LOGIC
                # ====================================================

                binary_buffer.extend(data)

                # Search for binary packet starting with:
                #
                # 01 03
                #
                while len(binary_buffer) >= 2:

                    # If packet does not start with 01 03
                    if (
                        binary_buffer[0] != 0x01
                        or binary_buffer[1] not in (0x03, 0x04)
                    ):

                        # Remove invalid byte
                        binary_buffer.pop(0)

                        continue

                    # Existing Modbus packet is 8 bytes
                    if len(binary_buffer) < 8:
                        break

                    # Extract complete binary packet
                    packet_bytes = bytes(
                        binary_buffer[:8]
                    )

                    # Remove processed packet
                    del binary_buffer[:8]

                    # Convert to same format
                    # used by existing code

                    hups_pkt = [
                        packet_bytes[0:2].hex().upper(),
                        packet_bytes[2:4].hex().upper(),
                        packet_bytes[4:6].hex().upper(),
                        packet_bytes[6:8].hex().upper()
                    ]

                    print(
                        f"\nBinary HUPS Packet: "
                        f"{hups_pkt}"
                    )

                    print(
                        f"Register Number: "
                        f"0x{hups_pkt[1]}")

                    # =================================================
                    # EXISTING RESPONSE GENERATION
                    # =================================================
                    resp_pkt = (
                        hups_pkt[0]
                        + hups_pkt[2][2:]
                        + register_values.get(hups_pkt[1], "0000")
                    )

                    # =================================================
                    # EXISTING CHECKSUM LOGIC
                    # =================================================

                    hups_pkt_bytes = bytes.fromhex(
                        "".join(hups_pkt[:3])
                    )

                    print(
                        "HUPS Incoming checksum: "
                        f"{modbus_crc16(hups_pkt_bytes):04X}"
                    )

                    # Generate response checksum

                    resp_pkt_bytes = bytes.fromhex(
                        resp_pkt
                    )

                    checksum = modbus_crc16(
                        resp_pkt_bytes
                    )

                    print(
                        f"Checksum: "
                        f"{checksum:04X}"
                    )

                    # =================================================
                    # FINAL BINARY RESPONSE
                    # =================================================

                    response = (

                        f"{resp_pkt}"

                        f"{checksum:04X}"

                    )

                    response_bytes = bytes.fromhex(
                        response
                    )

                    print(
                        f"Binary Response Packet: "
                        f"{response}"
                    )

                    # Send existing binary response

                    ser.write(
                        response_bytes
                    )

                    print(
                        "Binary response sent\n"
                    )

    except serial.SerialException as e:

        print(
            f"Serial error: {e}"
        )

    except KeyboardInterrupt:

        print(
            "\nStopped by user."
        )

    except Exception as e:

        print(
            f"Unexpected error: {e}"
        )


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    if len(sys.argv) < 2:

        print(
            "Usage: python read_serial_hex.py "
            "<PORT> [BAUDRATE]"
        )

        print(
            "Example: python read_serial_hex.py "
            "COM3 9600"
        )

        sys.exit(1)

    # HUPS BAUD RATE DEFAULT = 9600

    port_name = sys.argv[1]

    baud_rate = (
        int(sys.argv[2])
        if len(sys.argv) > 2
        else 9600
    )

    read_serial_as_hex(
        port_name,
        baud_rate
    )
