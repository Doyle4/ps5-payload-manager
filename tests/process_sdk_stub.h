#ifndef TEST_PROCESS_SDK_STUB_H
#define TEST_PROCESS_SDK_STUB_H
#if defined(__linux__)
#include_next <sys/user.h>
#endif
#include <stdint.h>
#include <sys/types.h>
/* Measured PS5 target SDK layout, not the host operating system's ABI.
 * Production static assertions check these offsets against the real SDK. */
struct kinfo_proc {
    int ki_structsize;
    char pad0[68];
    pid_t ki_pid;
    char pad1[188];
    int64_t ki_rssize;
    char pad2[122];
    char ki_tdname[17];
    char pad3[36];
    char ki_comm[20];
    char tail[621];
};
#endif
