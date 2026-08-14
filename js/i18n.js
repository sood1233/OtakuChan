// ─────────────────────────────────────────────────────────────
// I18N — lightweight translation layer. Supports English (default)
// plus 5 languages: Spanish, French, German, Portuguese, Japanese.
//
// Usage:
//   t('nav.home')                 -> translated string
//   t('toast.reportSubmitted')    -> translated string
//   applyStaticTranslations()     -> fills every [data-i18n],
//                                     [data-i18n-placeholder] and
//                                     [data-i18n-title] element on
//                                     the current page
//   setLang('es')                 -> persists + reloads the page
//
// To translate a new static string in an .html file, give the
// element data-i18n="some.key" (and add "some.key" to every
// language block below) instead of hardcoding the English text.
// Dynamic strings built in JS should call t('some.key') instead of
// writing the English literal inline.
// ─────────────────────────────────────────────────────────────

const I18N_LANGS = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  ja: '日本語'
};

const I18N_DICT = {
  en: {
    'nav.home': 'Home', 'nav.explore': 'Explore', 'nav.notifications': 'Notifications',
    'nav.chat': 'Chat', 'nav.bookmarks': 'Bookmarks', 'nav.lists': 'Lists', 'nav.articles': 'Articles',
    'nav.communities': 'Communities', 'nav.profile': 'Profile', 'nav.more': 'More',
    'nav.settings': 'Settings', 'nav.rules': 'Rules', 'nav.post': 'Post',
    'nav.about': 'About', 'nav.contact': 'Contact', 'nav.privacy': 'Privacy Policy', 'nav.terms': 'Terms of Service',
    'nav.logIn': 'Log in', 'nav.signUp': 'Sign up', 'nav.logOut': 'Log out',
    'compose.placeholder': "What's happening?",
    'compose.reply': 'Post your reply',
    'compose.submit': 'Post', 'compose.reply.submit': 'Reply', 'compose.cancel': 'Cancel',
    'action.follow': 'Follow', 'action.following': 'Following', 'action.unfollow': 'Unfollow',
    'action.report': 'Report', 'action.delete': 'Delete', 'action.save': 'Save',
    'action.edit': 'Edit', 'action.share': 'Share', 'action.copyLink': 'Copy link',
    'action.mute': 'Mute', 'action.block': 'Block', 'action.message': 'Message',
    'action.showMore': 'Show more',
    'time.now': 'just now', 'time.m': 'm ago', 'time.h': 'h ago', 'time.d': 'd ago',
    'toast.reportSubmitted': 'Report submitted. Moderators will review it.',
    'toast.linkCopied': 'Link copied to clipboard',
    'toast.muted': 'Account muted', 'toast.blocked': 'Account blocked',
    'auth.logIn': 'Log In', 'auth.logInSub': 'Good to see you again.',
    'auth.email': 'Email', 'auth.password': 'Password', 'auth.username': 'Username',
    'auth.noAccount': 'No account yet?', 'auth.haveAccount': 'Already have an account?',
    'auth.signUp': 'Sign Up', 'auth.signUpSub': 'Create your account.',
    'auth.legal': "By continuing you agree to InteractInk's rules.",
    'auth.rulesLink': 'rules',
    'settings.profile': 'Profile', 'settings.profileSub': 'Banner, avatar, display name, and bio.',
    'settings.editProfile': 'Edit Profile',
    'settings.appearance': 'Appearance', 'settings.appearanceSub': 'Pick how InteractInk looks on this device.',
    'settings.language': 'Language', 'settings.languageSub': 'Choose the language used throughout the site.',
    'settings.notifications': 'Notifications', 'settings.privacy': 'Privacy',
    'settings.account': 'Account', 'settings.password': 'Password', 'settings.session': 'Session'
  },
  es: {
    'nav.home': 'Inicio', 'nav.explore': 'Explorar', 'nav.notifications': 'Notificaciones',
    'nav.chat': 'Chat', 'nav.bookmarks': 'Guardados', 'nav.lists': 'Listas', 'nav.articles': 'Artículos',
    'nav.communities': 'Comunidades', 'nav.profile': 'Perfil', 'nav.more': 'Más',
    'nav.settings': 'Configuración', 'nav.rules': 'Normas', 'nav.post': 'Publicar',
    'nav.about': 'Acerca de', 'nav.contact': 'Contacto', 'nav.privacy': 'Política de privacidad', 'nav.terms': 'Términos del servicio',
    'nav.logIn': 'Iniciar sesión', 'nav.signUp': 'Registrarse', 'nav.logOut': 'Cerrar sesión',
    'compose.placeholder': '¿Qué está pasando?',
    'compose.reply': 'Publica tu respuesta',
    'compose.submit': 'Publicar', 'compose.reply.submit': 'Responder', 'compose.cancel': 'Cancelar',
    'action.follow': 'Seguir', 'action.following': 'Siguiendo', 'action.unfollow': 'Dejar de seguir',
    'action.report': 'Reportar', 'action.delete': 'Eliminar', 'action.save': 'Guardar',
    'action.edit': 'Editar', 'action.share': 'Compartir', 'action.copyLink': 'Copiar enlace',
    'action.mute': 'Silenciar', 'action.block': 'Bloquear', 'action.message': 'Mensaje',
    'action.showMore': 'Ver más',
    'time.now': 'ahora mismo', 'time.m': 'min', 'time.h': 'h', 'time.d': 'd',
    'toast.reportSubmitted': 'Reporte enviado. Los moderadores lo revisarán.',
    'toast.linkCopied': 'Enlace copiado al portapapeles',
    'toast.muted': 'Cuenta silenciada', 'toast.blocked': 'Cuenta bloqueada',
    'auth.logIn': 'Iniciar sesión', 'auth.logInSub': 'Qué bueno verte de nuevo.',
    'auth.email': 'Correo electrónico', 'auth.password': 'Contraseña', 'auth.username': 'Usuario',
    'auth.noAccount': '¿Aún no tienes cuenta?', 'auth.haveAccount': '¿Ya tienes una cuenta?',
    'auth.signUp': 'Registrarse', 'auth.signUpSub': 'Crea tu cuenta.',
    'auth.legal': 'Al continuar aceptas las normas de InteractInk.',
    'auth.rulesLink': 'normas',
    'settings.profile': 'Perfil', 'settings.profileSub': 'Portada, avatar, nombre y biografía.',
    'settings.editProfile': 'Editar perfil',
    'settings.appearance': 'Apariencia', 'settings.appearanceSub': 'Elige cómo se ve InteractInk en este dispositivo.',
    'settings.language': 'Idioma', 'settings.languageSub': 'Elige el idioma que se usa en todo el sitio.',
    'settings.notifications': 'Notificaciones', 'settings.privacy': 'Privacidad',
    'settings.account': 'Cuenta', 'settings.password': 'Contraseña', 'settings.session': 'Sesión'
  },
  fr: {
    'nav.home': 'Accueil', 'nav.explore': 'Explorer', 'nav.notifications': 'Notifications',
    'nav.chat': 'Discussion', 'nav.bookmarks': 'Signets', 'nav.lists': 'Listes', 'nav.articles': 'Articles',
    'nav.communities': 'Communautés', 'nav.profile': 'Profil', 'nav.more': 'Plus',
    'nav.settings': 'Paramètres', 'nav.rules': 'Règles', 'nav.post': 'Publier',
    'nav.about': 'À propos', 'nav.contact': 'Contact', 'nav.privacy': 'Politique de confidentialité', 'nav.terms': "Conditions d'utilisation",
    'nav.logIn': 'Connexion', 'nav.signUp': "S'inscrire", 'nav.logOut': 'Déconnexion',
    'compose.placeholder': "Quoi de neuf ?",
    'compose.reply': 'Publiez votre réponse',
    'compose.submit': 'Publier', 'compose.reply.submit': 'Répondre', 'compose.cancel': 'Annuler',
    'action.follow': 'Suivre', 'action.following': 'Abonné(e)', 'action.unfollow': 'Ne plus suivre',
    'action.report': 'Signaler', 'action.delete': 'Supprimer', 'action.save': 'Enregistrer',
    'action.edit': 'Modifier', 'action.share': 'Partager', 'action.copyLink': 'Copier le lien',
    'action.mute': 'Masquer', 'action.block': 'Bloquer', 'action.message': 'Message',
    'action.showMore': 'Voir plus',
    'time.now': "à l'instant", 'time.m': 'min', 'time.h': 'h', 'time.d': 'j',
    'toast.reportSubmitted': 'Signalement envoyé. Les modérateurs vont l\u2019examiner.',
    'toast.linkCopied': 'Lien copié dans le presse-papiers',
    'toast.muted': 'Compte masqué', 'toast.blocked': 'Compte bloqué',
    'auth.logIn': 'Connexion', 'auth.logInSub': 'Ravi de vous revoir.',
    'auth.email': 'E-mail', 'auth.password': 'Mot de passe', 'auth.username': "Nom d'utilisateur",
    'auth.noAccount': 'Pas encore de compte ?', 'auth.haveAccount': 'Vous avez déjà un compte ?',
    'auth.signUp': "S'inscrire", 'auth.signUpSub': 'Créez votre compte.',
    'auth.legal': 'En continuant, vous acceptez les règles d\u2019InteractInk.',
    'auth.rulesLink': 'règles',
    'settings.profile': 'Profil', 'settings.profileSub': 'Bannière, avatar, nom affiché et bio.',
    'settings.editProfile': 'Modifier le profil',
    'settings.appearance': 'Apparence', 'settings.appearanceSub': "Choisissez l'apparence d'InteractInk sur cet appareil.",
    'settings.language': 'Langue', 'settings.languageSub': 'Choisissez la langue utilisée sur tout le site.',
    'settings.notifications': 'Notifications', 'settings.privacy': 'Confidentialité',
    'settings.account': 'Compte', 'settings.password': 'Mot de passe', 'settings.session': 'Session'
  },
  de: {
    'nav.home': 'Start', 'nav.explore': 'Entdecken', 'nav.notifications': 'Benachrichtigungen',
    'nav.chat': 'Chat', 'nav.bookmarks': 'Lesezeichen', 'nav.lists': 'Listen', 'nav.articles': 'Artikel',
    'nav.communities': 'Communitys', 'nav.profile': 'Profil', 'nav.more': 'Mehr',
    'nav.settings': 'Einstellungen', 'nav.rules': 'Regeln', 'nav.post': 'Posten',
    'nav.about': 'Über uns', 'nav.contact': 'Kontakt', 'nav.privacy': 'Datenschutzerklärung', 'nav.terms': 'Nutzungsbedingungen',
    'nav.logIn': 'Anmelden', 'nav.signUp': 'Registrieren', 'nav.logOut': 'Abmelden',
    'compose.placeholder': 'Was gibt\u2019s Neues?',
    'compose.reply': 'Antwort posten',
    'compose.submit': 'Posten', 'compose.reply.submit': 'Antworten', 'compose.cancel': 'Abbrechen',
    'action.follow': 'Folgen', 'action.following': 'Gefolgt', 'action.unfollow': 'Entfolgen',
    'action.report': 'Melden', 'action.delete': 'Löschen', 'action.save': 'Speichern',
    'action.edit': 'Bearbeiten', 'action.share': 'Teilen', 'action.copyLink': 'Link kopieren',
    'action.mute': 'Stummschalten', 'action.block': 'Blockieren', 'action.message': 'Nachricht',
    'action.showMore': 'Mehr anzeigen',
    'time.now': 'gerade eben', 'time.m': ' Min.', 'time.h': ' Std.', 'time.d': ' T.',
    'toast.reportSubmitted': 'Meldung gesendet. Das Team wird sie prüfen.',
    'toast.linkCopied': 'Link in die Zwischenablage kopiert',
    'toast.muted': 'Konto stummgeschaltet', 'toast.blocked': 'Konto blockiert',
    'auth.logIn': 'Anmelden', 'auth.logInSub': 'Schön, dich wiederzusehen.',
    'auth.email': 'E-Mail', 'auth.password': 'Passwort', 'auth.username': 'Benutzername',
    'auth.noAccount': 'Noch kein Konto?', 'auth.haveAccount': 'Schon ein Konto?',
    'auth.signUp': 'Registrieren', 'auth.signUpSub': 'Erstelle dein Konto.',
    'auth.legal': 'Mit der Fortsetzung akzeptierst du die Regeln von InteractInk.',
    'auth.rulesLink': 'Regeln',
    'settings.profile': 'Profil', 'settings.profileSub': 'Banner, Avatar, Anzeigename und Bio.',
    'settings.editProfile': 'Profil bearbeiten',
    'settings.appearance': 'Darstellung', 'settings.appearanceSub': 'Lege fest, wie InteractInk auf diesem Gerät aussieht.',
    'settings.language': 'Sprache', 'settings.languageSub': 'Wähle die Sprache für die gesamte Seite.',
    'settings.notifications': 'Benachrichtigungen', 'settings.privacy': 'Privatsphäre',
    'settings.account': 'Konto', 'settings.password': 'Passwort', 'settings.session': 'Sitzung'
  },
  pt: {
    'nav.home': 'Início', 'nav.explore': 'Explorar', 'nav.notifications': 'Notificações',
    'nav.chat': 'Chat', 'nav.bookmarks': 'Salvos', 'nav.lists': 'Listas', 'nav.articles': 'Artigos',
    'nav.communities': 'Comunidades', 'nav.profile': 'Perfil', 'nav.more': 'Mais',
    'nav.settings': 'Configurações', 'nav.rules': 'Regras', 'nav.post': 'Publicar',
    'nav.about': 'Sobre', 'nav.contact': 'Contato', 'nav.privacy': 'Política de Privacidade', 'nav.terms': 'Termos de Serviço',
    'nav.logIn': 'Entrar', 'nav.signUp': 'Cadastrar-se', 'nav.logOut': 'Sair',
    'compose.placeholder': 'O que está acontecendo?',
    'compose.reply': 'Publique sua resposta',
    'compose.submit': 'Publicar', 'compose.reply.submit': 'Responder', 'compose.cancel': 'Cancelar',
    'action.follow': 'Seguir', 'action.following': 'Seguindo', 'action.unfollow': 'Deixar de seguir',
    'action.report': 'Denunciar', 'action.delete': 'Excluir', 'action.save': 'Salvar',
    'action.edit': 'Editar', 'action.share': 'Compartilhar', 'action.copyLink': 'Copiar link',
    'action.mute': 'Silenciar', 'action.block': 'Bloquear', 'action.message': 'Mensagem',
    'action.showMore': 'Ver mais',
    'time.now': 'agora mesmo', 'time.m': 'min', 'time.h': 'h', 'time.d': 'd',
    'toast.reportSubmitted': 'Denúncia enviada. A moderação vai analisar.',
    'toast.linkCopied': 'Link copiado para a área de transferência',
    'toast.muted': 'Conta silenciada', 'toast.blocked': 'Conta bloqueada',
    'auth.logIn': 'Entrar', 'auth.logInSub': 'Que bom te ver de novo.',
    'auth.email': 'E-mail', 'auth.password': 'Senha', 'auth.username': 'Usuário',
    'auth.noAccount': 'Ainda não tem conta?', 'auth.haveAccount': 'Já tem uma conta?',
    'auth.signUp': 'Cadastrar-se', 'auth.signUpSub': 'Crie sua conta.',
    'auth.legal': 'Ao continuar você concorda com as regras do InteractInk.',
    'auth.rulesLink': 'regras',
    'settings.profile': 'Perfil', 'settings.profileSub': 'Capa, avatar, nome de exibição e bio.',
    'settings.editProfile': 'Editar perfil',
    'settings.appearance': 'Aparência', 'settings.appearanceSub': 'Escolha a aparência do InteractInk neste dispositivo.',
    'settings.language': 'Idioma', 'settings.languageSub': 'Escolha o idioma usado em todo o site.',
    'settings.notifications': 'Notificações', 'settings.privacy': 'Privacidade',
    'settings.account': 'Conta', 'settings.password': 'Senha', 'settings.session': 'Sessão'
  },
  ja: {
    'nav.home': 'ホーム', 'nav.explore': '話題を検索', 'nav.notifications': '通知',
    'nav.chat': 'チャット', 'nav.bookmarks': 'ブックマーク', 'nav.lists': 'リスト', 'nav.articles': '記事',
    'nav.communities': 'コミュニティ', 'nav.profile': 'プロフィール', 'nav.more': 'もっと見る',
    'nav.settings': '設定', 'nav.rules': 'ルール', 'nav.post': '投稿',
    'nav.about': 'InteractInkについて', 'nav.contact': 'お問い合わせ', 'nav.privacy': 'プライバシーポリシー', 'nav.terms': '利用規約',
    'nav.logIn': 'ログイン', 'nav.signUp': '新規登録', 'nav.logOut': 'ログアウト',
    'compose.placeholder': 'いまどうしてる?',
    'compose.reply': '返信を投稿',
    'compose.submit': '投稿', 'compose.reply.submit': '返信', 'compose.cancel': 'キャンセル',
    'action.follow': 'フォロー', 'action.following': 'フォロー中', 'action.unfollow': 'フォロー解除',
    'action.report': '報告', 'action.delete': '削除', 'action.save': '保存',
    'action.edit': '編集', 'action.share': '共有', 'action.copyLink': 'リンクをコピー',
    'action.mute': 'ミュート', 'action.block': 'ブロック', 'action.message': 'メッセージ',
    'action.showMore': 'さらに表示',
    'time.now': 'たった今', 'time.m': '分前', 'time.h': '時間前', 'time.d': '日前',
    'toast.reportSubmitted': '報告を送信しました。モデレーターが確認します。',
    'toast.linkCopied': 'リンクをコピーしました',
    'toast.muted': 'アカウントをミュートしました', 'toast.blocked': 'アカウントをブロックしました',
    'auth.logIn': 'ログイン', 'auth.logInSub': 'おかえりなさい。',
    'auth.email': 'メールアドレス', 'auth.password': 'パスワード', 'auth.username': 'ユーザー名',
    'auth.noAccount': 'アカウントをお持ちでないですか?', 'auth.haveAccount': 'すでにアカウントをお持ちですか?',
    'auth.signUp': '新規登録', 'auth.signUpSub': 'アカウントを作成しましょう。',
    'auth.legal': '続行することで、InteractInkのルールに同意したものとみなされます。',
    'auth.rulesLink': 'ルール',
    'settings.profile': 'プロフィール', 'settings.profileSub': 'バナー、アイコン、表示名、自己紹介。',
    'settings.editProfile': 'プロフィールを編集',
    'settings.appearance': '外観', 'settings.appearanceSub': 'この端末でのInteractInkの見た目を選択します。',
    'settings.language': '言語', 'settings.languageSub': 'サイト全体で使用する言語を選択します。',
    'settings.notifications': '通知', 'settings.privacy': 'プライバシー',
    'settings.account': 'アカウント', 'settings.password': 'パスワード', 'settings.session': 'セッション'
  }
};

// Language codes that also have their own set of hand-translated
// static pages under /<code>/... (see I18N_STATIC_PAGES below), in
// addition to just a dictionary entry above. To add a new
// hand-translated language later: add its code here, add its /<code>/
// pages, and add the hreflang/footer links on the English pages —
// nothing else in this file needs to change.
const I18N_STATIC_LANGS = ['es', 'fr', 'de', 'pt', 'ja'];

function getLang() {
  // URL is the source of truth for the language-prefixed static pages
  // (/es/..., /fr/...) — a localized page should render in that
  // language for every visitor (and every bot) that lands on it, not
  // just users who happen to have previously picked it in Settings.
  try {
    if (typeof location !== 'undefined') {
      const m = location.pathname.match(/^\/([a-z]{2})(\/|$)/);
      if (m && I18N_STATIC_LANGS.includes(m[1])) return m[1];
    }
  } catch (e) {}
  try {
    const stored = localStorage.getItem('site_lang');
    if (stored && I18N_DICT[stored]) return stored;
  } catch (e) {}
  return 'en';
}

// Pages that exist as dedicated, hand-translated pages under
// /es/..., /fr/..., etc — the marketing/auth pages a logged-out
// visitor (or a search bot) lands on. Everything else (the logged-in
// app screens) has no translated twin, so switching language there
// just re-renders in place using the dictionary above instead of
// navigating.
const I18N_STATIC_PAGES = ['/', '/home', '/about', '/communities', '/contact', '/login', '/privacy', '/rules', '/signup', '/terms'];

// Maps the current URL to its equivalent under a different language,
// if one exists. Returns null when the current page has no
// hand-translated /<lang>/... twin (or, for 'en', no bare twin).
function localizedEquivalentPath(lang) {
  try {
    let path = location.pathname.replace(/\/+$/, '') || '/';
    path = path.replace(/\.html$/, '');
    const m = path.match(/^\/([a-z]{2})(\/|$)/);
    const curLang = (m && I18N_STATIC_LANGS.includes(m[1])) ? m[1] : null;
    const bare = curLang ? (path.slice(1 + curLang.length) || '/') : path;
    if (!I18N_STATIC_PAGES.includes(bare)) return null;
    if (lang === 'en') return bare;
    if (!I18N_STATIC_LANGS.includes(lang)) return null;
    return bare === '/' ? `/${lang}` : `/${lang}${bare}`;
  } catch (e) { return null; }
}

function setLang(lang) {
  if (!I18N_DICT[lang]) return;
  try { localStorage.setItem('site_lang', lang); } catch (e) {}
  // If the page you're on has a real translated/English twin, navigate
  // there so the site actually reloads into that language's version
  // instead of just re-rendering nav labels on the same page.
  const target = localizedEquivalentPath(lang);
  if (target && target !== location.pathname) {
    location.href = target;
    return;
  }
  location.reload();
}

function t(key) {
  const lang = getLang();
  return (I18N_DICT[lang] && I18N_DICT[lang][key]) || I18N_DICT.en[key] || key;
}

function applyStaticTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'))); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
  root.querySelectorAll('[data-i18n-value]').forEach(el => { el.setAttribute('value', t(el.getAttribute('data-i18n-value'))); });
}

// Builds the <select> used on the settings page (and anywhere else a
// language switcher is needed) — kept here so every page shares the
// exact same markup/behavior.
function langSelectHtml(id = 'lang-select') {
  const cur = getLang();
  const opts = Object.keys(I18N_LANGS).map(code =>
    `<option value="${code}" ${code === cur ? 'selected' : ''}>${I18N_LANGS[code]}</option>`
  ).join('');
  return `<select id="${id}" onchange="setLang(this.value)" style="width:auto;">${opts}</select>`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.setAttribute('lang', getLang());
  applyStaticTranslations();
});
