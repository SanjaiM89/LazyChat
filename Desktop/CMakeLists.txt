cmake_minimum_required(VERSION 3.21)
project(LazyChatDesktop VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets Network WebEngineWidgets)

qt_standard_project_setup()

set(OMNIA_SOURCES
  src/main.cpp
  src/core/embeddedredis.h
  src/core/embeddedredis.cpp
)

qt_add_executable(LazyChatDesktop ${OMNIA_SOURCES})

target_include_directories(LazyChatDesktop PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

target_link_libraries(LazyChatDesktop PRIVATE
  Qt6::Core
  Qt6::Gui
  Qt6::Widgets
  Qt6::Network
  Qt6::WebEngineWidgets
)

install(TARGETS LazyChatDesktop RUNTIME DESTINATION bin)
