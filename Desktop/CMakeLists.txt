cmake_minimum_required(VERSION 3.21)
project(OmniaDesktop VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets Network Concurrent WebEngineWidgets PdfWidgets Svg Test)

qt_standard_project_setup()

set(OMNIA_SOURCES
  src/main.cpp
  src/core/types.h
  src/core/datastore.h
  src/core/datastore.cpp
  src/core/models.h
  src/core/models.cpp
  src/core/display.h
  src/core/search.h
  src/core/search.cpp
  src/core/artifacts.h
  src/core/artifacts.cpp
  src/core/systemprompt.h
  src/core/systemprompt.cpp
  src/core/sandbox.h
  src/core/sandbox.cpp
  src/core/agents.h
  src/core/agents.cpp
  src/core/chromium.h
  src/core/chromium.cpp
  src/core/mcp.h
  src/core/mcp.cpp
  src/core/llmclient.h
  src/core/llmclient.cpp
  src/core/tools.h
  src/core/tools.cpp
  src/core/chatengine.h
  src/core/chatengine.cpp
  src/ui/theme.qrc
  src/ui/mainwindow.h
  src/ui/mainwindow.cpp
  src/ui/markdown.h
  src/ui/markdown.cpp
  src/ui/sidebar.h
  src/ui/sidebar.cpp
  src/ui/chatheader.h
  src/ui/chatheader.cpp
  src/ui/chatview.h
  src/ui/chatview.cpp
  src/ui/composer.h
  src/ui/composer.cpp
  src/ui/subchatpanel.h
  src/ui/subchatpanel.cpp
  src/ui/backgroundrunbar.h
  src/ui/backgroundrunbar.cpp
  src/ui/artifactpanel.h
  src/ui/artifactpanel.cpp
  src/ui/sandboxpanel.h
  src/ui/sandboxpanel.cpp
  src/ui/agentspanel.h
  src/ui/agentspanel.cpp
  src/ui/dialogs.h
  src/ui/dialogs.cpp
  src/ui/icons.h
  src/ui/icons.cpp
)

qt_add_executable(OmniaDesktop ${OMNIA_SOURCES})

target_include_directories(OmniaDesktop PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

target_link_libraries(OmniaDesktop PRIVATE
  Qt6::Core
  Qt6::Gui
  Qt6::Widgets
  Qt6::Network
  Qt6::Concurrent
  Qt6::WebEngineWidgets
  Qt6::PdfWidgets
  Qt6::Svg
  Qt6::Test
)

install(TARGETS OmniaDesktop RUNTIME DESTINATION bin)
