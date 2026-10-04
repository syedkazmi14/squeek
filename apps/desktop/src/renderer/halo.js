window.squeek.onState((state) => {
  if (["paused", "monitoring", "unknown", "risk"].includes(state.status))
    document.body.dataset.state = state.status;
});
