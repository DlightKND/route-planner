export default [{
  files: ["src/**/*.js"],
  languageOptions: {
    ecmaVersion: 2022, sourceType: "module",
    globals: { window:"readonly",document:"readonly",console:"readonly",fetch:"readonly",
      L:"readonly",turf:"readonly",ExcelJS:"readonly",localStorage:"readonly",navigator:"readonly",
      location:"readonly",setTimeout:"readonly",setInterval:"readonly",clearTimeout:"readonly",
      clearInterval:"readonly",Notification:"readonly",Blob:"readonly",URL:"readonly",
      atob:"readonly",btoa:"readonly",alert:"readonly",matchMedia:"readonly",
      requestAnimationFrame:"readonly",FileReader:"readonly",Image:"readonly",self:"readonly",
      getComputedStyle:"readonly",XMLHttpRequest:"readonly",history:"readonly",crypto:"readonly",
      // Функции, объявленные как window.X=... и вызываемые из onclick в строках
      // разметки. Линтер объявления не видит, но в браузере они разрешаются
      // через глобальную область — это не ошибки.
      addBaseStart:"readonly",addBaseStop:"readonly",addClientToRoute:"readonly",
      addEquipToRoute:"readonly",openEquip:"readonly",editClient:"readonly",
      newJobForClient:"readonly",newJobForEquip:"readonly",gotoSettings:"readonly",
      avoidRadius:"readonly",avoidDel:"readonly" }
  },
  rules: { "no-undef":"error" }
}];
