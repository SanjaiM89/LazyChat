#include <QApplication>
#include <QWebEngineView>
#include <QWebEngineSettings>
#include <QUrl>
#include <QProcess>
#include <QDir>
#include <QFile>
#include <QTimer>
#include <QThread>
#include <QTcpSocket>
#include <QCloseEvent>
#include <QSocketNotifier>

#include <unistd.h>
#include <csignal>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>

#ifdef __linux__
#include <sys/prctl.h>
#endif

#include "core/embeddedredis.h"

static pid_t g_nextPid = 0;

static void killPgrp(pid_t pid, int sig) {
  if (pid > 1) {
    kill(-pid, sig);
    kill(pid, sig);
  }
}

static void forceKillAll() {
  if (g_nextPid > 1) {
    killPgrp(g_nextPid, SIGKILL);
    g_nextPid = 0;
  }
}

static void cleanExitHandler() {
  forceKillAll();
}

static int sigFd[2];

static void signalHandler(int sig) {
  char a = 1;
  ssize_t ret = ::write(sigFd[0], &a, sizeof(a));
  (void)ret;
  (void)sig;
}

static void setupSignalHandlers(QApplication& app) {
  if (::socketpair(AF_UNIX, SOCK_STREAM, 0, sigFd)) return;
  auto* sn = new QSocketNotifier(sigFd[1], QSocketNotifier::Read, &app);
  QObject::connect(sn, &QSocketNotifier::activated, [&app, sn]() {
    sn->setEnabled(false);
    char tmp;
    ssize_t ret = ::read(sigFd[1], &tmp, sizeof(tmp));
    (void)ret;
    app.quit();
  });

  struct sigaction sa;
  std::memset(&sa, 0, sizeof(sa));
  sa.sa_handler = signalHandler;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = SA_RESTART;
  sigaction(SIGINT, &sa, nullptr);
  sigaction(SIGTERM, &sa, nullptr);
  sigaction(SIGHUP, &sa, nullptr);
}

static void stopProcessGracefully(QProcess& proc, pid_t& pidRef, int waitMs = 2000) {
  pid_t pid = pidRef;
  if (proc.state() == QProcess::NotRunning && pid <= 0) return;
  if (pid > 1) killPgrp(pid, SIGTERM);
  proc.terminate();
  if (!proc.waitForFinished(waitMs)) {
    if (pid > 1) killPgrp(pid, SIGKILL);
    proc.kill();
    proc.waitForFinished(1000);
  }
  pidRef = 0;
}

static bool waitForPort(int port, int timeoutMs) {
  for (int i = 0; i < timeoutMs / 100; ++i) {
    QTcpSocket s;
    s.connectToHost("127.0.0.1", port);
    if (s.waitForConnected(100)) {
      s.disconnectFromHost();
      return true;
    }
    QThread::msleep(100);
  }
  return false;
}

class MainWindow : public QWebEngineView {
public:
  using QWebEngineView::QWebEngineView;
protected:
  void closeEvent(QCloseEvent* event) override {
    event->accept();
    QCoreApplication::quit();
  }
};

int main(int argc, char** argv) {
  std::atexit(cleanExitHandler);

  // QtWebEngine's default X11 rendering path (desktop GL + in-process GPU)
  // does not push window height changes into the renderer's layout: after
  // the window is maximized or stretched, the page keeps the height it had
  // at startup, leaving a dead black band below the app and a phantom
  // overflow. Force Chromium's software path instead.
  {
    QByteArray flags = qgetenv("QTWEBENGINE_CHROMIUM_FLAGS");
    if (!flags.contains("--use-gl") && !flags.contains("--disable-gpu")) {
      if (!flags.isEmpty()) flags += ' ';
      flags += "--disable-gpu --use-gl=swiftshader";
      qputenv("QTWEBENGINE_CHROMIUM_FLAGS", flags);
      fprintf(stderr,
              "LazyChat: relaunching with QTWEBENGINE_CHROMIUM_FLAGS=%s\n",
              flags.constData());
      fflush(stderr);
      execv("/proc/self/exe", argv);
      if (strchr(argv[0], '/')) execv(argv[0], argv);
      fprintf(stderr, "LazyChat: relaunch failed (%s); continuing without software rendering\n",
              strerror(errno));
      fflush(stderr);
    } else {
      fprintf(stderr, "LazyChat: using existing QTWEBENGINE_CHROMIUM_FLAGS=%s\n",
              flags.constData());
      fflush(stderr);
    }
  }

  QApplication app(argc, argv);
  app.setQuitOnLastWindowClosed(true);
  setupSignalHandlers(app);

  omnia::EmbeddedRedis redis;
  redis.start(6379);

  // Start embedded Next.js server
  QString appDir = QCoreApplication::applicationDirPath();
  QString nextDir = appDir + "/../share/lazychat";
  QString nodeBin = appDir + "/node";
  QProcess nextProc;
  nextProc.setWorkingDirectory(nextDir);

#ifndef Q_OS_WIN
  nextProc.setChildProcessModifier([]() {
    setpgid(0, 0);
#ifdef __linux__
    prctl(PR_SET_PDEATHSIG, SIGKILL);
#endif
  });
#endif

  nextProc.start(nodeBin, QStringList() << "server.js");
  if (!nextProc.waitForStarted(5000)) {
    qWarning() << "Failed to start Next.js server:" << nextProc.errorString();
  } else {
    g_nextPid = static_cast<pid_t>(nextProc.processId());
  }

  waitForPort(3000, 30000);

  MainWindow view;
  view.setWindowTitle("LazyChat");
  view.resize(1280, 800);
  view.setAttribute(Qt::WA_DeleteOnClose);
  view.settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessRemoteUrls, true);
  view.load(QUrl("http://localhost:3000"));
  view.show();

  int rc = app.exec();

  stopProcessGracefully(nextProc, g_nextPid, 2000);
  redis.stop();
  forceKillAll();

  return rc;
}
