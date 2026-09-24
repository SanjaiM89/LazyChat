#include "dialogs.h"

#include <QDialogButtonBox>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QLabel>
#include <QPushButton>
#include <QVBoxLayout>

#include "core/datastore.h"
#include "core/display.h"
#include "core/mcp.h"
#include "core/models.h"

namespace omnia {

static QDialogButtonBox* makeButtons(QWidget* parent, QDialog* box,
                                     std::function<void()> onSave = {}) {
  auto* bb = new QDialogButtonBox(QDialogButtonBox::Save | QDialogButtonBox::Cancel, box);
  QObject::connect(bb, &QDialogButtonBox::accepted, box, [box, onSave] {
    if (onSave) onSave();
    box->accept();
  });
  QObject::connect(bb, &QDialogButtonBox::rejected, box, &QDialog::reject);
  Q_UNUSED(parent);
  return bb;
}

// ---------------- API keys ----------------
ApiKeysDialog::ApiKeysDialog(QWidget* parent) : QDialog(parent) {
  setWindowTitle("API keys");
  resize(560, 380);
  auto* root = new QVBoxLayout(this);
  auto* body = new QHBoxLayout();
  list_ = new QListWidget();
  list_->setMaximumWidth(200);
  for (const ProviderConfig& p : builtinProviders()) {
    auto* item = new QListWidgetItem(p.name);
    item->setData(Qt::UserRole, p.id);
    list_->addItem(item);
  }
  connect(list_, &QListWidget::currentItemChanged, this, [this](QListWidgetItem* cur) {
    if (!cur) return;
    currentProvider_ = cur->data(Qt::UserRole).toString();
    edit_->setText(resolveApiKey(currentProvider_));
  });
  body->addWidget(list_);
  auto* right = new QVBoxLayout();
  auto* hint = new QLabel("Stored in data/provider-keys.json (local only).");
  hint->setProperty("muted", true);
  hint->setWordWrap(true);
  edit_ = new QLineEdit();
  edit_->setEchoMode(QLineEdit::Password);
  edit_->setPlaceholderText("sk-…");
  auto* clear = new QPushButton("Clear key");
  connect(clear, &QPushButton::clicked, this, [this] {
    if (!currentProvider_.isEmpty()) DataStore::deleteProviderKey(currentProvider_);
    edit_->clear();
  });
  right->addWidget(hint);
  right->addWidget(edit_);
  right->addWidget(clear, 0, Qt::AlignLeft);
  right->addStretch(1);
  body->addLayout(right, 1);
  root->addLayout(body, 1);
  if (list_->count()) list_->setCurrentRow(0);
  root->addWidget(makeButtons(this, this, [this] {
    if (!currentProvider_.isEmpty()) DataStore::setProviderKey(currentProvider_, edit_->text());
  }));
}

void ApiKeysDialog::load() {}

void ApiKeysDialog::saveCurrent() {
  if (!currentProvider_.isEmpty()) DataStore::setProviderKey(currentProvider_, edit_->text());
}

// ---------------- Display ----------------
DisplaySettingsDialog::DisplaySettingsDialog(QWidget* parent) : QDialog(parent) {
  setWindowTitle("Display settings");
  auto* root = new QVBoxLayout(this);
  const DisplaySettings d = loadDisplay();
  auto* row1 = new QHBoxLayout();
  row1->addWidget(new QLabel("Font"));
  fontBox_ = new QComboBox();
  for (const auto& p : displayFonts()) fontBox_->addItem(p.second, p.first);
  const int idx = fontBox_->findData(d.font);
  fontBox_->setCurrentIndex(idx >= 0 ? idx : 0);
  row1->addWidget(fontBox_, 1);
  root->addLayout(row1);

  auto* row2 = new QHBoxLayout();
  row2->addWidget(new QLabel("Font size"));
  sizeSpin_ = new QSpinBox();
  sizeSpin_->setRange(13, 20);
  sizeSpin_->setValue(d.fontSize);
  row2->addWidget(sizeSpin_);
  row2->addStretch(1);
  root->addLayout(row2);

  auto* row3 = new QHBoxLayout();
  row3->addWidget(new QLabel("Content width"));
  widthSpin_ = new QSpinBox();
  widthSpin_->setRange(560, 1600);
  widthSpin_->setSingleStep(20);
  widthSpin_->setValue(d.contentWidth);
  row3->addWidget(widthSpin_);
  row3->addStretch(1);
  root->addLayout(row3);

  root->addWidget(makeButtons(this, this, [this] {
    DisplaySettings out;
    out.font = fontBox_->currentData().toString();
    out.fontSize = sizeSpin_->value();
    out.contentWidth = widthSpin_->value();
    saveDisplay(out);
  }));
}

// ---------------- Skills ----------------
SkillsDialog::SkillsDialog(QWidget* parent) : QDialog(parent) {
  setWindowTitle("Skills");
  resize(640, 420);
  auto* root = new QVBoxLayout(this);
  auto* body = new QHBoxLayout();
  list_ = new QListWidget();
  list_->setMaximumWidth(220);
  body->addWidget(list_);
  auto* form = new QVBoxLayout();
  form->addWidget(new QLabel("Name"));
  name_ = new QLineEdit();
  form->addWidget(name_);
  form->addWidget(new QLabel("Description"));
  desc_ = new QLineEdit();
  form->addWidget(desc_);
  form->addWidget(new QLabel("Prompt"));
  prompt_ = new QPlainTextEdit();
  form->addWidget(prompt_, 1);
  auto* addBtn = new QPushButton("Add / Update");
  addBtn->setProperty("accent", true);
  connect(addBtn, &QPushButton::clicked, this, &SkillsDialog::add);
  auto* delBtn = new QPushButton("Remove");
  connect(delBtn, &QPushButton::clicked, this, &SkillsDialog::removeSelected);
  auto* row = new QHBoxLayout();
  row->addWidget(addBtn);
  row->addWidget(delBtn);
  row->addStretch(1);
  form->addLayout(row);
  body->addLayout(form, 1);
  root->addLayout(body, 1);
  connect(list_, &QListWidget::itemClicked, this, [this](QListWidgetItem* item) {
    const QVector<SkillDef> all = listSkills();
    for (const SkillDef& s : all)
      if (s.id == item->data(Qt::UserRole).toString()) {
        name_->setText(s.name);
        desc_->setText(s.description);
        prompt_->setPlainText(s.prompt);
      }
  });
  load();
}

void SkillsDialog::load() {
  list_->clear();
  for (const SkillDef& s : listSkills()) {
    auto* item = new QListWidgetItem(s.name);
    item->setData(Qt::UserRole, s.id);
    list_->addItem(item);
  }
}

void SkillsDialog::add() {
  if (name_->text().trimmed().isEmpty()) return;
  QVector<SkillDef> all = listSkills();
  SkillDef def;
  def.id = newId(8);
  def.name = name_->text().trimmed();
  def.description = desc_->text();
  def.prompt = prompt_->toPlainText();
  def.source = "user";
  def.updatedAt = nowMs();
  for (SkillDef& s : all)
    if (s.name == def.name) {
      def.id = s.id;
      s = def;
      saveSkills(all);
      load();
      return;
    }
  all.push_back(def);
  saveSkills(all);
  load();
}

void SkillsDialog::removeSelected() {
  auto* item = list_->currentItem();
  if (!item) return;
  QVector<SkillDef> all = listSkills();
  for (int i = 0; i < all.size(); ++i)
    if (all[i].id == item->data(Qt::UserRole).toString()) all.removeAt(i);
  saveSkills(all);
  load();
}

// ---------------- MCP connections ----------------
ConnectionsDialog::ConnectionsDialog(QWidget* parent) : QDialog(parent) {
  setWindowTitle("MCP connections");
  resize(640, 420);
  auto* root = new QVBoxLayout(this);
  auto* body = new QHBoxLayout();
  list_ = new QListWidget();
  list_->setMaximumWidth(240);
  body->addWidget(list_);
  auto* form = new QVBoxLayout();
  form->addWidget(new QLabel("Name"));
  name_ = new QLineEdit();
  form->addWidget(name_);
  form->addWidget(new QLabel("Command (stdio)"));
  cmd_ = new QLineEdit();
  form->addWidget(cmd_);
  form->addWidget(new QLabel("Args (space separated)"));
  args_ = new QLineEdit();
  form->addWidget(args_);
  form->addWidget(new QLabel("URL (http/sse)"));
  url_ = new QLineEdit();
  form->addWidget(url_);
  auto* addBtn = new QPushButton("Add");
  addBtn->setProperty("accent", true);
  connect(addBtn, &QPushButton::clicked, this, &ConnectionsDialog::add);
  auto* delBtn = new QPushButton("Remove");
  connect(delBtn, &QPushButton::clicked, this, &ConnectionsDialog::removeSelected);
  auto* row = new QHBoxLayout();
  row->addWidget(addBtn);
  row->addWidget(delBtn);
  row->addStretch(1);
  form->addLayout(row);
  form->addStretch(1);
  body->addLayout(form, 1);
  root->addLayout(body, 1);
  connect(list_, &QListWidget::itemChanged, this, [this](QListWidgetItem* item) {
    toggleEnabled(item);
  });
  load();
}

void ConnectionsDialog::load() {
  list_->clear();
  for (const MCPServerDef& s : McpRegistry::instance().servers()) {
    auto* item = new QListWidgetItem((s.enabled ? "● " : "○ ") + s.name);
    item->setData(Qt::UserRole, s.id);
    item->setFlags(item->flags() | Qt::ItemIsUserCheckable);
    item->setCheckState(s.enabled ? Qt::Checked : Qt::Unchecked);
    list_->addItem(item);
  }
}

void ConnectionsDialog::add() {
  if (name_->text().trimmed().isEmpty()) return;
  MCPServerDef d;
  d.id = newId(8);
  d.name = name_->text().trimmed();
  d.command = cmd_->text();
  d.args = args_->text().split(' ', Qt::SkipEmptyParts);
  d.url = url_->text();
  d.type = d.url.isEmpty() ? "stdio" : "http";
  d.enabled = true;
  McpRegistry::instance().addServer(d);
  name_->clear();
  cmd_->clear();
  args_->clear();
  url_->clear();
  load();
}

void ConnectionsDialog::removeSelected() {
  auto* item = list_->currentItem();
  if (!item) return;
  McpRegistry::instance().removeServer(item->data(Qt::UserRole).toString());
  load();
}

void ConnectionsDialog::toggleEnabled(QListWidgetItem* item) {
  McpRegistry::instance().setEnabled(item->data(Qt::UserRole).toString(),
                                     item->checkState() == Qt::Checked);
}

// ---------------- Search providers ----------------
SearchProvidersDialog::SearchProvidersDialog(QWidget* parent) : QDialog(parent) {
  setWindowTitle("Search providers");
  resize(640, 420);
  auto* root = new QVBoxLayout(this);
  auto* body = new QHBoxLayout();
  list_ = new QListWidget();
  list_->setMaximumWidth(240);
  body->addWidget(list_);
  auto* form = new QVBoxLayout();
  form->addWidget(new QLabel("Name"));
  name_ = new QLineEdit();
  form->addWidget(name_);
  form->addWidget(new QLabel("Kind (brave | serper | tavily | jina | direct)"));
  kind_ = new QLineEdit("brave");
  form->addWidget(kind_);
  form->addWidget(new QLabel("API key"));
  key_ = new QLineEdit();
  key_->setEchoMode(QLineEdit::Password);
  form->addWidget(key_);
  form->addWidget(new QLabel("Base URL"));
  url_ = new QLineEdit();
  form->addWidget(url_);
  auto* addBtn = new QPushButton("Add");
  addBtn->setProperty("accent", true);
  connect(addBtn, &QPushButton::clicked, this, &SearchProvidersDialog::add);
  auto* delBtn = new QPushButton("Remove");
  connect(delBtn, &QPushButton::clicked, this, &SearchProvidersDialog::removeSelected);
  auto* row = new QHBoxLayout();
  row->addWidget(addBtn);
  row->addWidget(delBtn);
  row->addStretch(1);
  form->addLayout(row);
  form->addStretch(1);
  body->addLayout(form, 1);
  root->addLayout(body, 1);
  load();
}

void SearchProvidersDialog::load() {
  list_->clear();
  for (const SearchProviderDef& s : listSearchProviders()) {
    auto* item = new QListWidgetItem(s.name + " · " + s.kind);
    item->setData(Qt::UserRole, s.id);
    list_->addItem(item);
  }
}

void SearchProvidersDialog::add() {
  if (name_->text().trimmed().isEmpty()) return;
  QVector<SearchProviderDef> all = listSearchProviders();
  SearchProviderDef d;
  d.id = newId(8);
  d.name = name_->text().trimmed();
  d.kind = kind_->text().trimmed();
  d.apiKey = key_->text();
  d.baseUrl = url_->text();
  d.enabled = true;
  d.createdAt = nowMs();
  d.updatedAt = d.createdAt;
  all.push_back(d);
  saveSearchProviders(all);
  name_->clear();
  key_->clear();
  url_->clear();
  load();
}

void SearchProvidersDialog::removeSelected() {
  auto* item = list_->currentItem();
  if (!item) return;
  QVector<SearchProviderDef> all = listSearchProviders();
  for (int i = 0; i < all.size(); ++i)
    if (all[i].id == item->data(Qt::UserRole).toString()) all.removeAt(i);
  saveSearchProviders(all);
  load();
}

// ---------------- Manage models ----------------
ManageModelsDialog::ManageModelsDialog(QWidget* parent) : QDialog(parent) {
  setWindowTitle("Manage models");
  resize(640, 420);
  auto* root = new QVBoxLayout(this);
  auto* row0 = new QHBoxLayout();
  providerBox_ = new QComboBox();
  for (const ProviderConfig& p : allProviders()) providerBox_->addItem(p.name, p.id);
  row0->addWidget(providerBox_);
  row0->addStretch(1);
  root->addLayout(row0);

  auto* body = new QHBoxLayout();
  modelList_ = new QListWidget();
  body->addWidget(modelList_, 1);
  auto* form = new QVBoxLayout();
  form->addWidget(new QLabel("Model id"));
  idEdit_ = new QLineEdit();
  form->addWidget(idEdit_);
  form->addWidget(new QLabel("Display name"));
  nameEdit_ = new QLineEdit();
  form->addWidget(nameEdit_);
  auto* addBtn = new QPushButton("Add");
  auto* renBtn = new QPushButton("Rename");
  auto* delBtn = new QPushButton("Delete");
  delBtn->setProperty("danger", true);
  connect(addBtn, &QPushButton::clicked, this, &ManageModelsDialog::addModel);
  connect(renBtn, &QPushButton::clicked, this, &ManageModelsDialog::renameModel);
  connect(delBtn, &QPushButton::clicked, this, &ManageModelsDialog::removeModel);
  auto* row = new QHBoxLayout();
  row->addWidget(addBtn);
  row->addWidget(renBtn);
  row->addWidget(delBtn);
  row->addStretch(1);
  form->addLayout(row);
  form->addStretch(1);
  body->addLayout(form, 1);
  root->addLayout(body, 1);

  connect(providerBox_, &QComboBox::currentIndexChanged, this, [this] { load(); });
  connect(modelList_, &QListWidget::itemClicked, this, [this](QListWidgetItem* item) {
    idEdit_->setText(item->data(Qt::UserRole).toString());
    nameEdit_->setText(item->text());
  });
  load();
}

void ManageModelsDialog::load() {
  modelList_->clear();
  const QString pid = providerBox_->currentData().toString();
  for (const ModelConfig& m : effectiveModels(pid)) {
    auto* item = new QListWidgetItem(m.name);
    item->setData(Qt::UserRole, m.id);
    item->setToolTip(m.id);
    modelList_->addItem(item);
  }
}

void ManageModelsDialog::addModel() {
  const QString pid = providerBox_->currentData().toString();
  if (idEdit_->text().trimmed().isEmpty()) return;
  ModelConfig m;
  m.id = idEdit_->text().trimmed();
  m.name = nameEdit_->text().isEmpty() ? m.id : nameEdit_->text();
  addProviderModel(pid, m);
  load();
}

void ManageModelsDialog::renameModel() {
  auto* item = modelList_->currentItem();
  if (!item) return;
  const QString pid = providerBox_->currentData().toString();
  ModelConfig m = findModel(pid, item->data(Qt::UserRole).toString());
  if (m.id.isEmpty()) return;
  m.name = nameEdit_->text();
  renameProviderModel(pid, m.id, m);
  load();
}

void ManageModelsDialog::removeModel() {
  auto* item = modelList_->currentItem();
  if (!item) return;
  deleteProviderModel(providerBox_->currentData().toString(), item->data(Qt::UserRole).toString());
  load();
}

// ---------------- Custom provider ----------------
CustomProviderDialog::CustomProviderDialog(QWidget* parent) : QDialog(parent) {
  setWindowTitle("Custom provider");
  auto* root = new QVBoxLayout(this);
  root->addWidget(new QLabel("Name"));
  name_ = new QLineEdit();
  root->addWidget(name_);
  root->addWidget(new QLabel("Base URL"));
  baseUrl_ = new QLineEdit("https://api.example.com/v1");
  root->addWidget(baseUrl_);
  root->addWidget(new QLabel("API key"));
  apiKey_ = new QLineEdit();
  apiKey_->setEchoMode(QLineEdit::Password);
  root->addWidget(apiKey_);
  root->addWidget(new QLabel("Protocol"));
  protocol_ = new QComboBox();
  protocol_->addItems({"openai", "anthropic", "gemini"});
  root->addWidget(protocol_);
  root->addWidget(new QLabel("Models (ids, comma separated)"));
  models_ = new QLineEdit();
  root->addWidget(models_);
  auto* bb = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel, this);
  connect(bb, &QDialogButtonBox::accepted, this, &CustomProviderDialog::accept);
  connect(bb, &QDialogButtonBox::rejected, this, &CustomProviderDialog::reject);
  root->addWidget(bb);
}

void CustomProviderDialog::accept() {
  if (name_->text().trimmed().isEmpty()) return;
  rec_ = CustomProviderRecord{};
  rec_.id = uniqueProviderId(name_->text().trimmed());
  rec_.name = name_->text().trimmed();
  rec_.baseUrl = baseUrl_->text();
  rec_.apiKey = apiKey_->text();
  rec_.protocol = protocolFromString(protocol_->currentText());
  rec_.createdAt = nowMs();
  rec_.updatedAt = rec_.createdAt;
  for (const QString& id : models_->text().split(',', Qt::SkipEmptyParts)) {
    CustomModelDef m;
    m.id = id.trimmed();
    m.name = m.id;
    if (!m.id.isEmpty()) rec_.models.push_back(m);
  }
  QDialog::accept();
}

}  // namespace omnia
