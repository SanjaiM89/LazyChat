FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake ninja-build git wget curl ca-certificates \
    qt6-base-dev qt6-declarative-dev qt6-webengine-dev qt6-svg-dev \
    libgl1-mesa-dev libxkbcommon-dev libfontconfig1-dev libfreetype6-dev \
    libx11-dev libxext-dev libxfixes-dev libxi-dev libxrender-dev \
    libxcb1-dev libxcb-cursor-dev libxcb-icccm4-dev libxcb-image0-dev \
    libxcb-keysyms1-dev libxcb-randr0-dev libxcb-render-util0-dev \
    libxcb-shape0-dev libxcb-shm0-dev libxcb-sync-dev libxcb-xfixes0-dev \
    libxcb-xkb-dev libxkbcommon-x11-dev \
    libfuse2 file \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . /src

RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j$(nproc)

# Download AppImage tools (inside container, where Qt libs exist)
RUN curl -sL -o /usr/local/bin/linuxdeploy https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage && chmod +x /usr/local/bin/linuxdeploy &&     curl -sL -o /usr/local/bin/appimagetool https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage && chmod +x /usr/local/bin/appimagetool && \
    curl -sL -o /usr/local/bin/linuxdeploy-plugin-qt https://github.com/linuxdeploy/linuxdeploy-plugin-qt/releases/download/continuous/linuxdeploy-plugin-qt-x86_64.AppImage && chmod +x /usr/local/bin/linuxdeploy-plugin-qt

# Stage AppDir
RUN mkdir -p AppDir/usr/bin AppDir/usr/share/applications &&     cp build/LazyChatDesktop AppDir/usr/bin/ &&     cp bin/redis-server AppDir/usr/bin/ &&     cp lib/liblzf.so.1 AppDir/usr/lib/ 2>/dev/null || true &&     printf "[Desktop Entry]\nType=Application\nName=LazyChatDesktop\nExec=LazyChatDesktop\nIcon=omnia\nCategories=Utility;\n" > AppDir/usr/share/applications/omnia.desktop

# Bundle Qt deps (FUSE may be unavailable in container; use extract-and-run)
ENV APPIMAGE_EXTRACT_AND_RUN=1
RUN /usr/local/bin/linuxdeploy --appdir AppDir --executable AppDir/usr/bin/LazyChatDesktop || true
RUN /usr/local/bin/appimagetool AppDir /src/LazyChatDesktop.AppImage || true



# Package as AppImage
RUN rm -rf AppDir && mkdir -p AppDir/usr/bin AppDir/usr/share/applications AppDir/usr/share/icons/hicolor/256x256/apps &&     cp build/LazyChatDesktop AppDir/usr/bin/ &&     cp -r nextjs AppDir/usr/share/lazychat &&     cp bin/node AppDir/usr/bin/ &&     printf "[Desktop Entry]\nType=Application\nName=LazyChatDesktop\nExec=LazyChatDesktop\nIcon=omnia\nCategories=Utility;\n" > AppDir/usr/share/applications/omnia.desktop &&     echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" | base64 -d > AppDir/usr/share/icons/hicolor/256x256/apps/omnia.png &&     export QMAKE=/usr/lib/qt6/bin/qmake; export LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu; /usr/local/bin/linuxdeploy --appdir AppDir --executable AppDir/usr/bin/LazyChatDesktop --plugin qt 2>&1 | tail -5 &&     cp bin/redis-server AppDir/usr/bin/ &&     mkdir -p AppDir/usr/lib &&     cp lib/liblzf.so.1 AppDir/usr/lib/ &&     /usr/local/bin/appimagetool AppDir /src/LazyChatDesktop.AppImage 2>&1 | tail -3

CMD ["ls", "-la", "/src/LazyChatDesktop.AppImage"]

