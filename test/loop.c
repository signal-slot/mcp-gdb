#include <stdio.h>
#include <unistd.h>

int main() {
    printf("Starting loop...\n");
    int i = 0;
    while(1) {
        i++;
        usleep(100000); // 0.1s wait to avoid 100% CPU
        if (i % 10 == 0) {
            printf("Loop count: %d\n", i);
        }
    }
    return 0;
}
