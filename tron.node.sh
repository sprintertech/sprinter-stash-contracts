#!/bin/bash

docker run --rm \
  --name tron \
  -it \
  -p 127.0.0.1:9090:9090 \
  -e mnemonic="test test test test test test test test test test test junk" \
  tronbox/tre
