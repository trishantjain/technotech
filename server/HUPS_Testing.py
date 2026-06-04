import serial
import sys
import binascii
import re

# DICT STORING REGISTER NUMBER OF HUPS & ITS VALUE [IN HEX]
register_values = {
    # MPPT ALARM
    "0190": "0001",  # [0001] 1 - working, [0000] 0 - alarm

    # OVERLOAD ALARM
    "0188": "0001",  # [0001] 1 - working, [0000] 0 - alarm

    # MAINS ALARM
    "0180": "0001",  # [0001] 1 - working, [0000] 0 - alarm

    # HUPS - FR FAIL
    # EMS - RECTIFIER ALARM
    "0186": "0001",  # [0001] 1 - working, [0000] 0 - alarm

    # BAT VOLT
    # HEX VALUES
    "021C": "000C",  # 12V

    # LOAD CURRENT
    "021E": "1518",  # 5400

    # HUPS - MPPT 1 OUTPUT VOLT
    # EMS - OUTPUT VOLTAGE
    "024E": "1518",  # 10mV

    # HUPS - MPPT 1 INPUT VOLT
    # EMS - INPUT VOLTAGE
    "0256": "125C",  # 4700
}


# uint16_t modbus_crc16(uint8_t *data, int len)
# {
#     uint16_t crc = 0xFFFF;
#     for (int i = 0; i < len; i++)
#         {
#            crc ^= data[i];
#            for (int j = 0; j < 8; j++)
#                {
#                   if (crc & 1)
#                   {
#                       crc = (crc >> 1) ^ 0xA001;
#                   }
#                   else
#                   {
#                       crc >>= 1;
#                   }
#                }
#         }
#     return crc;
# }

def modbus_crc16(data: bytes) -> int:
    crc = 0xFFFF

    for byte in data:
        crc ^= byte

        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1

    reversed_checksum = ((crc & 0xFF) << 8) | ((crc >> 8) & 0xFF)

    return reversed_checksum


def read_serial_as_hex(port: str, baudrate: int = 9600, timeout: float = 1.0):
    """
    Reads binary data from a serial port and prints it in hexadecimal format.

    :param port: Serial port name (e.g., 'COM3' on Windows, '/dev/ttyUSB0' on Linux)
    :param baudrate: Baud rate for serial communication
    :param timeout: Read timeout in seconds
    """
    try:
        # Open serial port
        with serial.Serial(port, baudrate, timeout=timeout) as ser:
            print(f"Connected to {port} at {baudrate} baud.")
            print("Press Ctrl+C to stop.\n")

            hups_pkt = []
            res_pkt = ""
            while True:
                # READING TWO BYTES AT A TIME
                data = ser.read(2)
                if data:
                    # CONVERTING BINARY DATA TO HEX STRING (uppercase, space-separated)
                    hex_str = binascii.hexlify(data).decode('ascii').upper()

                    # CHECKING FOR '0103' IN THE HEX STRING [STARTING OF HUPS PKT]
                    if (hex_str == '0103'):
                        hups_pkt = ['0103']

                        # RUNS LOOP 3 TIMES AFTER READING '0103'
                        for _ in range(3):
                            data = ser.read(2)
                            hex_str = binascii.hexlify(
                                data).decode('ascii').upper()

                            hups_pkt.append(hex_str)

                        # PRINTING HUPS PKT
                        print(f'hups_pkt: {hups_pkt}')
                        print(f'Register Number: {hups_pkt[1]}')

                        # GENERATING RESPONSE PACKET
                        resp_pkt = f"{hups_pkt[0]}{hups_pkt[2][2:]}{register_values.get(hups_pkt[1], '0000')}"

                        # CONVERTING RESPONSE PACKET TO BYTES FOR GENERATING CHECKSUM
                        resp_pkt_bytes = bytes.fromhex(resp_pkt)

                        #! CAN BE REMOVED
                        hups_pkt_bytes = bytes.fromhex(''.join(hups_pkt[:3]))

                        #! CAN BE REMOVED
                        print(f"HUPS Incoming checksum: {modbus_crc16(hups_pkt_bytes):04X}")

                        # GENERATING CHECKSUM FOR RESPONSE PACKET       
                        checksum = modbus_crc16(resp_pkt_bytes)

                        print("Checksum: {:04X}".format(checksum))

                        response = f"{resp_pkt}{checksum:04X}"

                        # RESPONSE PACKET IN BYTES
                        response_bytes = bytes.fromhex(response)

                        print(f"Response Packet: {response}")

                        ser.write(response_bytes)
                        print("\n")

                        # RESETIGN HUPS PKT
                        hups_pkt = []

    except serial.SerialException as e:
        print(f"Serial error: {e}")
    except KeyboardInterrupt:
        print("\nStopped by user.")
    except Exception as e:
        print(f"Unexpected error: {e}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python read_serial_hex.py <PORT> [BAUDRATE]")
        print("Example: python read_serial_hex.py COM3 115200")
        sys.exit(1)

    port_name = sys.argv[1]
    baud_rate = int(sys.argv[2]) if len(sys.argv) > 2 else 9600

    read_serial_as_hex(port_name, baud_rate)
