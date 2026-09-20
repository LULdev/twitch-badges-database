export default function ThemeScript() {
  const code = `(function(){try{var t=localStorage.getItem('tbd_theme');var c=t==='light'?'light':'dark';document.documentElement.classList.add(c);}catch(e){document.documentElement.classList.add('dark');}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
