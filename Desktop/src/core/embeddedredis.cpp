#include "embeddedredis.h"

#include <QCoreApplication>
#include <QDir>
#include <QDebug>

#ifndef Q_OS_WIN
#include <csignal>
#include <unistd.h>
#ifdef __linux__
#include <sys/prctl.h>
#endif
#endif

namespace omnia {

EmbeddedRedis::EmbeddedRedis(QObject* parent) : QObject(parent) {
  process_ = new QProcess(this);
}

EmbeddedRedis::~EmbeddedRedis() {
  stop();
}

bool EmbeddedRedis::start(int port) {
  port_ = port;
  if (process_->state() == QProcess::Running) return true;

  QString appDir = QCoreApplication::applicationDirPath();
  QString binary;
#ifdef Q_OS_WIN
  // try same dir first, then bin/
  if (QFile::exists(appDir + "/redis-server.exe")) binary = appDir + "/redis-server.exe";
  else binary = appDir + "/bin/redis-server.exe";
#else
  if (QFile::exists(appDir + "/redis-server")) binary = appDir + "/redis-server";
  else binary = appDir + "/bin/redis-server";
#endif

  QStringList args;
  args << "--port" << QString::number(port);

#ifndef Q_OS_WIN
  process_->setChildProcessModifier([]() {
    setpgid(0, 0);
#ifdef __linux__
    prctl(PR_SET_PDEATHSIG, SIGKILL);
#endif
  });
#endif

  process_->start(binary, args);
  if (!process_->waitForStarted(5000)) {
    qWarning() << "Failed to start embedded Redis:" << process_->errorString();
    return false;
  }
  qDebug() << "Embedded Redis started on port" << port;
  return true;
}

void EmbeddedRedis::stop() {
  if (process_ && process_->state() == QProcess::Running) {
    qint64 pid = process_->processId();
#ifndef Q_OS_WIN
    if (pid > 0) {
      kill(-static_cast<pid_t>(pid), SIGTERM);
    }
#endif
    process_->terminate();
    if (!process_->waitForFinished(2000)) {
#ifndef Q_OS_WIN
      if (pid > 0) {
        kill(-static_cast<pid_t>(pid), SIGKILL);
      }
#endif
      process_->kill();
      process_->waitForFinished(1000);
    }
  }
}

bool EmbeddedRedis::isRunning() const {
  return process_ && process_->state() == QProcess::Running;
}

}  // namespace omnia
