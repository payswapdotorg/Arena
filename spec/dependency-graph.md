# Arena Dependency Graph

## Core

A001 → A002/A003/A004/A009/A015
A002 → A006/A009/A011/A014/A016/A025
A003 → A005/A016/A021/A022/A024/A025
A004 → A005/A006/A019/A021
A005 → A007/A008/A012/A025
A006 → A007/A008/A017/A031
A007 → A008/A031
A009 → A010/A011/A017
A010 → A011/A028/A029/A036
A011 → A012/A014/A019/A020
A012 → A013/A014/A019/A020/A030
A013 → A007/A014/A020/A023/A028/A029
A014 → A023/A032
A015 → A010/A017/A018/A025/A033/A034/A035/A036
A016 → A022
A019 → A020/A021
A020 → A021/A022
A021 → A022/A023/A024
A022 → A023/A024
A023 → A024/A028/A029/A030/A031/A032
A024 → A025/A026/A028/A029/A031/A032/A033
A025 → A026/A027/A028/A029
A026 → A027
A027 → no successor
A028 → A030
A029 → no fixed successor
A030 → A036
A031/A032/A033 → A036
A034 → A035/A036
A035 → A036

## Safe concurrency examples

These examples never override dependency readiness or ownership checks.

After A001:
- A002
- A003
- A004

Another valid trio:
- A006
- A009
- A015

Later:
- A007
- A008
- A010

Later:
- A017
- A018
- A019

Later:
- A021
- A022
- A024

Later:
- A031
- A032
- A033

## Parallelism rules

- Three active workers maximum.
- No shared write surface.
- No shared package manifest during a parallel wave.
- No root lockfile changes in worker PRs.
- Shared contract changes land before consumers.
- Tech Lead serializes dependency and lockfile reconciliation.
- Workers do not routinely rebase onto each other.
