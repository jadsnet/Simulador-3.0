<p align="center">

# 🚀 Simulador Academy

### Plataforma Web para Simulados e Certificações

HTML • CSS • JavaScript • IndexedDB • GitHub Pages

<img src="docs/banner.png" width="100%">

</p>

<p align="center">

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![PWA](https://img.shields.io/badge/PWA-5A0FC8?style=for-the-badge)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?style=for-the-badge&logo=githubpages)

</p>

---

# ✨ Recursos

- 📚 Banco ilimitado de questões
- 📥 Importação CSV UTF-8
- 🖼️ Imagens no enunciado e alternativas
- ✅ Questões Single Choice
- ☑️ Questões Multiple Choice
- 💾 Salvar progresso automaticamente
- ▶️ Continuar exatamente de onde parou
- 📊 Estatísticas completas
- 📝 Revisão detalhada
- ⭐ Favoritos
- 🚩 Marcar para revisar
- 📜 Histórico completo
- 📦 Backup
- ♻️ Restauração
- 🌐 Funciona totalmente no navegador

---

# 🏠 Dashboard

<img src="docs/dashboard.png">

A tela principal concentra todo o gerenciamento do sistema.

### Recursos

- 📚 Biblioteca de bancos
- 📥 Importação de CSV
- 🖼️ Importação de imagens
- 📈 Estatísticas
- 🕒 Histórico
- ⚡ Ações rápidas

---

# ⚙ Configuração do Simulado

<img src="docs/configuracao.png">

Antes de iniciar um simulado você pode configurar:

- Número de questões
- Tempo máximo
- Embaralhar questões
- Avisar questões não respondidas

---

# 📝 Execução do Simulado

<img src="docs/prova.png">

Durante a prova o sistema entra em **Focus Mode**.

A interface apresenta apenas:

- Questão atual
- Barra de progresso
- Tempo
- Questões respondidas
- Botões Anterior
- Próxima
- Salvar e sair

Todo o restante da interface fica oculto para aumentar a concentração.

---

# 📊 Resultado

<img src="docs/revisao.png">

Ao finalizar o simulado são apresentados:

- 🟢 Acertos
- 🔴 Erros
- 🔵 Aproveitamento

Além disso, cada questão possui:

- Enunciado
- Categoria
- Resposta marcada
- Resposta correta
- Feedback
- Imagens

---

# 🔍 Revisão Inteligente

Filtros disponíveis:

|Filtro|Descrição|
|------|---------|
|📋 Todas|Todas as questões|
|❌ Erradas|Somente erros|
|✅ Corretas|Somente acertos|
|⏳ Não respondidas|Questões em branco|
|⭐ Favoritas|Favoritas|
|🚩 Marcadas|Marcadas para revisão|

---

# 📂 Estrutura do CSV

|Campo|Descrição|
|------|---------|
|id|Identificador|
|categoria|Categoria|
|tipo|single ou multiple|
|pergunta|Enunciado|
|imagem_pergunta|Imagem|
|alt_a|Alternativa A|
|img_a|Imagem A|
|...|...|
|correta|Resposta|
|feedback|Explicação|

---

# 🔄 Fluxo do Sistema

```text
Importar CSV
      │
      ▼
Importar imagens
      │
      ▼
Criar banco
      │
      ▼
Configurar prova
      │
      ▼
Executar
      │
      ▼
Salvar (opcional)
      │
      ▼
Finalizar
      │
      ▼
Revisão
      │
      ▼
Histórico
```

---

# 🛠 Tecnologias

- HTML5
- CSS3
- JavaScript ES6
- IndexedDB
- GitHub Pages
- Service Worker

---

# 🚀 Roadmap

- ✅ Focus Mode
- ✅ Histórico detalhado
- ✅ Revisão completa
- 🔄 Flash Cards
- 🔄 Dashboard avançado
- 🔄 Estatísticas por categoria
- 🔄 Ranking
- 🔄 Modo estudo

---

# 📷 Galeria

|Dashboard|Execução|
|---------|---------|
|![](docs/dashboard_small.png)|![](docs/prova_small.png)|

|Resultado|Configuração|
|---------|------------|
|![](docs/revisao_small.png)|![](docs/configuracao_small.png)|

---

# 💾 Backup

O sistema permite exportar e restaurar:

- Bancos
- Histórico
- Favoritos
- Estatísticas
- Configurações

---

# 📜 Licença

Projeto desenvolvido para estudos e preparação para certificações.
