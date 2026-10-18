<script lang="ts">
	import '../theme.css';
	import { ModeWatcher } from 'mode-watcher';

	let { children } = $props();
</script>

<ModeWatcher />
<div
	class="min-h-dvh bg-background text-foreground"
	style="padding-bottom: env(safe-area-inset-bottom)"
>
	{@render children()}
</div>
