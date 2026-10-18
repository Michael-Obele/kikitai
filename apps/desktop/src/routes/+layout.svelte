<script lang="ts">
	import '../theme.css';
	import { ModeWatcher } from 'mode-watcher';

	let { children } = $props();
</script>

<ModeWatcher />
<div class="min-h-screen" data-tauri-drag-region>
	{@render children()}
</div>
