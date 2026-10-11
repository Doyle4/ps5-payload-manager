#include "ps5_launcher.h"
#include "pldmgr.h"
#include "history_mgr.h"
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

#include <stdint.h>

int ps5_launch_elf(const char *path) {
  pldmgr_log("[PLDMGR] Sending ELF to local loader: %s\n", path);

  /* Open the payload file */
  int fd = open(path, O_RDONLY);
  if (fd < 0) {
    pldmgr_log("[PLDMGR] !!! Failed to open payload: %s\n", path);
    return -1;
  }

  struct stat st;
  fstat(fd, &st);
  size_t total_sent = 0;

  /* Create socket to local elfldr */
  int sock = socket(AF_INET, SOCK_STREAM, 0);
  if (sock < 0) {
    perror("socket");
    close(fd);
    return -1;
  }

  struct sockaddr_in server_addr;
  server_addr.sin_family = AF_INET;
  server_addr.sin_port = htons(ELFLDR_PORT);
  server_addr.sin_addr.s_addr = inet_addr("127.0.0.1");

  if (connect(sock, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
    pldmgr_log("[PLDMGR] !!! Connection to elfldr (port %d) failed. Is it "
           "running?\n",
           ELFLDR_PORT);
    close(sock);
    close(fd);
    return -1;
  }

  /* Stream the file */
  char buffer[8192];
  ssize_t read_bytes;
  int error = 0;
  while ((read_bytes = read(fd, buffer, sizeof(buffer))) > 0) {
    size_t offset = 0;
    while (offset < (size_t)read_bytes) {
      ssize_t sent = send(sock, buffer + offset, (size_t)read_bytes - offset, 0);
      if (sent <= 0) {
        pldmgr_log("[PLDMGR] !!! send failed while launching payload\n");
        error = 1;
        break;
      }
      offset += (size_t)sent;
      total_sent += (size_t)sent;
    }
    if (error)
      break;
  }

  if (read_bytes < 0) {
    pldmgr_log("[PLDMGR] !!! read failed while launching payload\n");
    error = 1;
  }

  pldmgr_log("[PLDMGR] Sent %zu bytes to loader.\n", total_sent);

  close(sock);
  close(fd);
  if (!error) {
    history_mgr_add(path);
  }
  return error ? -1 : 0;
}

extern int sceSystemServiceLaunchWebBrowser(const char *uri);

int ps5_launch_browser(const char *uri) {
  pldmgr_log("[PLDMGR] Launching browser: %s\n", uri);
  if (sceSystemServiceLaunchWebBrowser(uri) != 0) {
    pldmgr_notify("[PLDMGR] !!! Failed to launch browser.");
    return -1;
  }
  return 0;
}
