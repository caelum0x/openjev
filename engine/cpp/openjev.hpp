#pragma once
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Hash-trick character 3-grams into a dense bag. */
void openjev_hash_ngrams(const char *text, double *out, int dim);

/* Cosine similarity of two dense vectors. */
double openjev_cosine(const double *a, const double *b, int n);

/* Softmax with temperature into out[n]. */
void openjev_softmax(const double *logits, int n, double temperature, double *out);

/* Shannon entropy of a probability vector. */
double openjev_entropy(const double *p, int n);

/* Peakedness confidence in [0, 1]. */
double openjev_confidence(const double *p, int n);

/*
 * Evaluate a TypeSafe System One request.
 * json_in: {"model":"...","state":...,"questions":{...}}
 * Writes a NUL-terminated JSON response into out.
 * Returns bytes written (excluding NUL) on success.
 * -1 out_cap too small, -2 parse/eval error.
 */
int openjev_eval(const char *json_in, char *out, int out_cap);

/* Heap-allocated JSON response. Caller must openjev_free. NULL on error. */
char *openjev_eval_dup(const char *json_in);
void openjev_free(char *p);

const char *openjev_version(void);

#ifdef __cplusplus
}
#endif
