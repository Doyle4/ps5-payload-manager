#include <stdlib.h>
#include <sys/types.h>
void *test_malloc(size_t size);
int test_kill(pid_t pid, int signal);
#define malloc test_malloc
#define kill test_kill
