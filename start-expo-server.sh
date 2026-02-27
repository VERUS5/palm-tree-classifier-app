#!/bin/bash
export EXPO_PACKAGER_PROXY_URL=https://expo.vverussserver.com
export REACT_NATIVE_PACKAGER_HOSTNAME=expo.vverussserver.com
export EXPO_PUBLIC_DOMAIN=api.vverussserver.com
npx expo start --port 8081 --non-interactive
