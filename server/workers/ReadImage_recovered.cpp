// ReadImage.cpp : This file contains the 'main' function. Program execution begins and ends there.
//
#define _CRT_SECURE_NO_WARNINGS // Disables secure warnings
#include <iostream>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#define _WINSOCK_DEPRECATED_NO_WARNINGS
#include <WinSock2.h>
#pragma comment(lib, "WS2_32.lib")
#pragma warning(disable : 4996) /* for _CRT_SECURE_NO_WARNINGS */

#include <conio.h>
#include <io.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <Windows.h>
#include <WS2tcpip.h>
unsigned short run_flag = 1; /* to keep system running */
HANDLE kb_Handle, tmr_Handle;
unsigned long kb_threadId, tmr_threadId;
constexpr auto TIMER_TICK = 10;						// base tick is 10 mili second;
unsigned short idle_timer = 5000 / TIMER_TICK;
SOCKET	sckConnImg = INVALID_SOCKET; 	/* Client Socket */
SOCKADDR_IN sockinImg; /* SOCKADDR_IN structure Holds address,port, etc. */

static unsigned long _stdcall tmr_handler(void* dummy)
{
	while (run_flag)
	{
		Sleep(TIMER_TICK);	// 10 mili-seconds

		if (run_flag)
		{
			run_flag--;
		}

	}
	Sleep(100);
	return 0;
}
static unsigned long _stdcall kb_handler(void* dummy)
{
	static unsigned char mode2 = 0;
	printf("\nStarting KB handler");
	while (run_flag)
	{
		if (_kbhit())
		{
			unsigned char ch = toupper(_getch());
			if (ch == 'Q')
			{
				run_flag = 0;
				return 0;
			}
			if (ch >= '0' && ch <= '9')
			{
				if (mode2 == 1)
				{

				}
				else if (mode2 == 2)
				{
				}
				mode2 = 0;
			}
		}
		Sleep(100);
	}
	Sleep(500);
	return 0;
}
static void ConnectImage(const char* remoteip)
{
    printf("\n[1] ConnectImage() called with IP: %s", remoteip);

    char ip_addr[40];
    int dest_port = 8324;

    printf("\n[2] Target port: %d", dest_port);

    if (!remoteip || strlen(remoteip) < 5)
    {
        printf("\n[ERROR] Invalid IP address");
        exit(1);
    }
    else
    {
        strcpy(ip_addr, remoteip);
    }

    printf("\n[4] Creating socket...");
    sckConnImg = socket(AF_INET, SOCK_STREAM, 0);
    if (sckConnImg == INVALID_SOCKET)
    {
        printf("\nIMG socket() failed: %d", WSAGetLastError());
        exit(1);
    }

    printf("\n[SUCCESS] Socket created, handle: %d", sckConnImg);

    // Set socket timeouts
    int timeout = 5000; // 5 seconds
    setsockopt(sckConnImg, SOL_SOCKET, SO_RCVTIMEO, (char*)&timeout, sizeof(timeout));
    setsockopt(sckConnImg, SOL_SOCKET, SO_SNDTIMEO, (char*)&timeout, sizeof(timeout));

    printf("\n[5] Setting SO_REUSEADDR...");
    memset(&sockinImg, 0, sizeof(sockinImg));

    int reuse = 1;
    if (setsockopt(sckConnImg, SOL_SOCKET, SO_REUSEADDR, (char*)&reuse, sizeof(reuse)) == SOCKET_ERROR) {
        printf("\n[WARNING] SO_REUSEADDR failed: %d", WSAGetLastError());
    }
    else {
        printf("\n[SUCCESS] SO_REUSEADDR enabled");
    }

    printf("\n[6] Setting SO_LINGER...");
    struct linger linger_opt = { 1, 0 };
    setsockopt(sckConnImg, SOL_SOCKET, SO_LINGER, (char*)&linger_opt, sizeof(linger_opt));
    printf("\n[SUCCESS] SO_LINGER set");

    printf("\n[8] Preparing sockaddr structure...");
    sockinImg.sin_family = AF_INET;
    sockinImg.sin_addr.s_addr = inet_addr(ip_addr);
    sockinImg.sin_port = htons(dest_port);
    printf("\n[SUCCESS] Address structure ready");

    printf("\n[9] Attempting to connect...");
    if (connect(sckConnImg, (SOCKADDR FAR*) & sockinImg, sizeof(SOCKADDR_IN)) == SOCKET_ERROR)
    {
        int err = WSAGetLastError();
        printf("\n[ERROR] Not able to connect to %s:%d - Error: %d", ip_addr, dest_port, err);
        closesocket(sckConnImg);
        sckConnImg = INVALID_SOCKET;
        exit(1);
    }
    printf("\n[SUCCESS] Connected to %s:%d", ip_addr, dest_port);
}

static void get_timestamp_filename(char* buffer, size_t buffer_size)
{
	time_t raw_time;
	struct tm time_info;

	// Get current time
	time(&raw_time);

	// Get local time info (Visual Studio secure version)
	localtime_s(&time_info, &raw_time);

	// Format: YYYYMMDD_HHMMSS
	char time_str[20];
	strftime(time_str, sizeof(time_str), "%Y%m%d_%H%M%S", &time_info);

	// Build the final filename
	sprintf_s(buffer, buffer_size, "%s.jpeg", time_str);
}

#define host_to_ip(x)	"192.168.0.28"
char filename[100];
char indata[1024];
int inlen, fromlen; /* no of bytes rcvd */
static void save_image(unsigned char* img_data, unsigned long img_size)
{
	FILE* fp = fopen(filename, "wb");
	if (!fp)
	{
		printf("\r\nERROR: Cannot create %s ", filename);
		return;
	}

	fwrite(img_data, 1, img_size, fp);
	fclose(fp);

	printf("\r\nSaved: %s (%lu bytes)", filename, img_size);
}

static void recv_jpeg(void)
{
    printf("\n\n=== Starting JPEG Reception ===");
    printf("\n[10] Socket handle: %d", sckConnImg);

    constexpr auto HEADER_SIZE = 8;
#define MAX_IMAGE_SIZE (230*1024)

    char header[HEADER_SIZE + 1] = { 0 };
    unsigned long header_received = 0;
    unsigned long image_size = 0;
    unsigned long image_received = 0;
    unsigned char* image_buffer = NULL;
    unsigned long total_received = 0;
    unsigned long pending;

    // Timeout variables
    int timeout_counter = 0;
    const int TIMEOUT_LIMIT = 5000; // 5 seconds
    DWORD last_data_time;

    printf("\r\nPhase 1: Waiting for 8-byte image size header...");
    while (header_received < HEADER_SIZE)
    {
        fromlen = sizeof(sockinImg);
        if (ioctlsocket(sckConnImg, FIONREAD, &pending) == SOCKET_ERROR)
        {
            printf("\r\nioctlsocket error: %d ", WSAGetLastError());
            return;
        }

        if (pending > 0)
        {
            int recv_len = recvfrom(sckConnImg, &header[header_received], HEADER_SIZE - header_received, 0, (struct sockaddr*)&sockinImg, &fromlen);

            if (recv_len == SOCKET_ERROR)
            {
                printf("\r\nrecv header error: %d ", WSAGetLastError());
                return;
            }

            if (recv_len > 0)
            {
                header_received += recv_len;
                printf("\r\nHeader progress: %lu/%lu bytes ", header_received, HEADER_SIZE);
                timeout_counter = 0; // Reset timeout on data received
            }
        }
        else
        {
            timeout_counter++;
            if (timeout_counter > TIMEOUT_LIMIT) {
                printf("\r\n[ERROR] Header timeout after 5 seconds - no data from STM\n");
                printf("[ERROR] Exiting with code 1 (NO DATA)\n");
                exit(1);
            }
        }
        Sleep(1);
    }

    // Parse ASCII length
    header[HEADER_SIZE] = '\0';
    image_size = atol((char*)header);
    printf("\r\nImage size parsed: %lu bytes ", image_size);

    if (image_size == 0 || image_size > MAX_IMAGE_SIZE)
    {
        printf("\r\nInvalid image size: %lu ", image_size);
        printf("\r\n[ERROR] Exiting with code 1 (INVALID SIZE)\n");
        exit(1);
    }

    // Allocate image buffer
    image_buffer = (unsigned char*)malloc(image_size);
    if (!image_buffer)
    {
        printf("\r\nMemory allocation failed for %lu bytes", image_size);
        printf("\r\n[ERROR] Exiting with code 1 (ALLOC FAIL)\n");
        exit(1);
    }

    printf("\r\nPhase 2: Receiving %lu bytes image data...", image_size);
    printf("\r\nSaving to: %s ", filename);
    fflush(stdout);

    // Reset timeout for data reception
    timeout_counter = 0;
    last_data_time = GetTickCount();

    while (image_received < image_size)
    {
        fromlen = sizeof(sockinImg);
        if (ioctlsocket(sckConnImg, FIONREAD, &pending) == SOCKET_ERROR)
        {
            printf("\r\nioctlsocket error during image: %d ", WSAGetLastError());
            break;
        }

        if (pending > 0)
        {
            int max_chunk = min(pending, (int)(image_size - image_received));
            int recv_len = recvfrom(sckConnImg, (char*)&image_buffer[image_received], max_chunk, 0, (struct sockaddr*)&sockinImg, &fromlen);

            if (recv_len == SOCKET_ERROR)
            {
                printf("\r\nrecv image error: %d ", WSAGetLastError());
                break;
            }

            if (recv_len > 0)
            {
                image_received += recv_len;
                total_received += recv_len;
                timeout_counter = 0;
                last_data_time = GetTickCount();

                // Print progress every 10%
                static int last_percent = 0;
                int percent = (image_received * 100) / image_size;
                if (percent >= last_percent + 10) {
                    printf("\r\n[PROGRESS] %d%% (%lu/%lu bytes)", percent, image_received, image_size);
                    last_percent = percent;
                    fflush(stdout);
                }
            }
        }
        else
        {
            // Check for timeout
            DWORD now = GetTickCount();
            DWORD elapsed = now - last_data_time;

            if (elapsed > 5000) { // 5 seconds timeout
                printf("\r\n[ERROR] Data timeout! No data for %dms at %lu/%lu bytes (%.1f%%)",
                    elapsed, image_received, image_size,
                    (image_received * 100.0) / image_size);

                // Save partial image for debugging
                if (image_received > 0) {
                    printf("\r\n[Saving partial image for debugging]");
                    save_image(image_buffer, image_received);
                }

                if (image_buffer) free(image_buffer);

                if (sckConnImg != INVALID_SOCKET) {
                    closesocket(sckConnImg);
                    sckConnImg = INVALID_SOCKET;
                }

                printf("\r\n[ERROR] Exiting with code 1 (PARTIAL/TIMEOUT)\n");
                fflush(stdout);
                exit(1);
            }

            timeout_counter++;
        }
        Sleep(1);
    }

    // Save image if we got data
    if (image_received > 0)
    {
        printf("\r\nTransfer complete: %lu/%lu bytes ", image_received, image_size);

        if (image_received == image_size)
        {
            printf("SUCCESS: Image fully received\n");
            save_image(image_buffer, image_received);

            // Close the socket before exiting
            if (sckConnImg != INVALID_SOCKET) {
                shutdown(sckConnImg, SD_BOTH);
                closesocket(sckConnImg);
                sckConnImg = INVALID_SOCKET;
                printf("\nSocket closed successfully\n");
            }

            free(image_buffer);
            printf("\n[SUCCESS] Exiting with code 0\n");
            exit(0);
        }
        else
        {
            printf("WARNING: Partial image received (%lu/%lu bytes)\n", image_received, image_size);

            // Save partial image for debugging
            if (image_received > 0) {
                save_image(image_buffer, image_received);
            }

            if (image_buffer) free(image_buffer);

            if (sckConnImg != INVALID_SOCKET) {
                closesocket(sckConnImg);
                sckConnImg = INVALID_SOCKET;
            }

            printf("[ERROR] Exiting with code 1 (PARTIAL)\n");
            exit(1);
        }
    }

    // No data received
    if (image_buffer) free(image_buffer);
    printf("\r\n[ERROR] No data received\n");
    exit(1);
}
int main(int argc, char* argv[])
{
	printf("\n=== ReadImage Debug Log ===");
	printf("\nProcess ID: %d", GetCurrentProcessId());
	printf("\nStart time: %s", __TIMESTAMP__);

	if (argc < 3) {
		printf("Usage: ReadImage.exe <ip> <outputPath>\n");
		return 1;
	}

	const char* ip = argv[1];
	const char* outputPath = argv[2];
	printf("\nArguments received:");
	printf("\n  - IP: %s", ip);
	printf("\n  - Output: %s", outputPath);

	strcpy(filename, outputPath);

	int ticker = 0;
	printf("\nRead Image : Press Q to terminate at any Time");
	run_flag = 200;
	// RECEIVE ALL SOCKET AND THREAD
	kb_Handle = CreateThread(NULL, 0, kb_handler, 0, 0, &kb_threadId);
	tmr_Handle = CreateThread(NULL, 0, tmr_handler, 0, 0, &tmr_threadId);
	{
		WSADATA	wsd;	/* Used to check version and initialize winsock */
		if (WSAStartup(MAKEWORD(2, 2), &wsd) != 0)
		{
			printf("\nWSAStartup() failed: %d", GetLastError());
		}
	}

	// REMOVE TO PROVIDE CUSTOM FILE PATH
	// get_timestamp_filename(filename, sizeof(filename));

	printf("\n Filename: %s\n", filename);
	// ConnectImage(host_to_ip(argv[1]));
	ConnectImage(ip);
	while (run_flag)
	{
		if (sckConnImg != INVALID_SOCKET) /* make suer we have an open connection */
		{
			recv_jpeg();
#if 0
			unsigned long pending;
			/*gets the data usin gour socket and stores it in our variable */
			indata[0] = 0; /* clear any pending data */
			fromlen = sizeof(sockinImg);
			ioctlsocket(sckConnImg, FIONREAD, &pending);
			if (pending && ((inlen = recvfrom(sckConnImg, indata, sizeof(indata), 0, (struct sockaddr*)&sockinImg, &fromlen)) != SOCKET_ERROR))
			{
				if (inlen > 4)
				{
					printf("\r\nRcv[L%d]..", inlen);
					run_flag = 200;
				}

				memset(indata, 0, sizeof(indata)); /* clear rcvd info */
			}
#endif
		}
		Sleep(10);
		if (ticker++ > 10)
		{
			printf(".");
			fflush(stdout);
			ticker = 0;
		}
	}
	closesocket(sckConnImg);	/* close the socket */
	WSACleanup();				/* shuts down WSA ?? */
	Sleep(100); /* give some time to other task for clean up */
}