/* Embedded mode: when GovCareer AI is shown inside the Campus portal tab (?embed=1 or inside a frame),
   mark the page so embed.css can drop the duplicate chrome. Nothing else changes. */
(function () {
  try {
    var framed = window.self !== window.top;
    var flag = /(?:^|[?&])embed=1(?:&|$)/.test(window.location.search);
    if (framed || flag) document.documentElement.classList.add('is-embedded');
  } catch (e) {
    document.documentElement.classList.add('is-embedded');
  }
})();
