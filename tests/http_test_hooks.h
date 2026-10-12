#ifndef HTTP_TEST_HOOKS_H
#define HTTP_TEST_HOOKS_H

#include <stdlib.h>
#include <microhttpd.h>

/* Inject faults only into the production HTTP translation unit. The test
 * implementations use the real libmicrohttpd response objects/destructors. */
void *http_test_malloc(size_t size);
struct MHD_Response *http_test_create_response(size_t size, void *buffer,
                                              enum MHD_ResponseMemoryMode mode);
struct MHD_Response *http_test_create_callback(uint64_t size, size_t block_size,
    MHD_ContentReaderCallback reader, void *cls, MHD_ContentReaderFreeCallback cleanup);
enum MHD_Result http_test_queue(struct MHD_Connection *connection,
                               unsigned int status, struct MHD_Response *response);
void http_test_destroy(struct MHD_Response *response);
enum MHD_Result http_test_add_header(struct MHD_Response *response,
                                    const char *name, const char *value);
const char *http_test_lookup(struct MHD_Connection *connection,
                            enum MHD_ValueKind kind, const char *key);

#define malloc http_test_malloc
#define MHD_create_response_from_buffer http_test_create_response
#define MHD_create_response_from_callback http_test_create_callback
#define MHD_queue_response http_test_queue
#define MHD_destroy_response http_test_destroy
#define MHD_add_response_header http_test_add_header
#define MHD_lookup_connection_value http_test_lookup

#endif
