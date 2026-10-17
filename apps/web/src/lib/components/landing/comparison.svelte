<script lang="ts">
	import { Check, Minus } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	/**
	 * Rows are structural, not marketing. Every one of them is decided by the
	 * OAuth scope and where the model runs, so it is checkable in the source.
	 * `ours: 'no'` marks the two rows where Kikitai refusing to do something is the point.
	 */
	type Row = { label: string; us: string; them: string; ours: 'yes' | 'no' };

	const rows: Row[] = [
		{ label: 'Scope it asks for', us: 'gmail.readonly', them: 'read, modify, send', ours: 'yes' },
		{ label: 'Can delete a message', us: 'never, no code path', them: 'yes', ours: 'no' },
		{ label: 'Can send for you', us: 'never', them: 'yes', ours: 'no' },
		{
			label: 'Labels it applies',
			us: 'kept in this app’s database',
			them: 'written back to Gmail',
			ours: 'yes'
		},
		{
			label: 'Where the voice is made',
			us: 'in your browser',
			them: 'vendor servers',
			ours: 'yes'
		},
		{
			label: 'Where the mail text goes',
			us: 'your own model endpoint',
			them: 'vendor model endpoint',
			ours: 'yes'
		},
		{
			label: 'Cost of the voice',
			us: '$0, no per character billing',
			them: 'billed per character',
			ours: 'yes'
		},
		{ label: 'Self-host', us: 'docker compose up', them: 'no', ours: 'yes' }
	];

	const neighbours = ['inbox-zero', 'Mail-0/Zero', 'aomail', 'aziru', 'Omni-Email'];
</script>

<div>
	<div class="max-w-2xl">
		<p class="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
			Read-only, on purpose
		</p>
		<h3 class="mt-3 font-heading text-title italic">The smallest permission that does the job</h3>
		<p class="mt-3 text-sm leading-relaxed text-muted-foreground">
			Most AI mail assistants ask for the right to send, delete and relabel. That is a lot of trust
			to hand over for something meant to save you ten minutes. Kikitai asks for one scope and never
			writes back to Gmail.
		</p>
	</div>

	<div class="mt-8 overflow-x-auto">
		<table class="w-full min-w-xl border-collapse text-sm">
			<thead>
				<tr class="border-b">
					<th
						class="py-3 pr-4 text-left text-[11px] font-normal tracking-[0.2em] text-muted-foreground uppercase"
					>
						&nbsp;
					</th>
					<th class="px-4 py-3 text-left text-[11px] font-normal tracking-[0.2em] uppercase">
						Kikitai
					</th>
					<th
						class="px-4 py-3 text-left text-[11px] font-normal tracking-[0.2em] text-muted-foreground uppercase"
					>
						A typical AI mail assistant
					</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.label)}
					<tr class="border-b">
						<th scope="row" class="py-3.5 pr-4 text-left font-normal text-muted-foreground">
							{row.label}
						</th>
						<td class="px-4 py-3.5">
							<span class="flex items-start gap-2">
								{#if row.ours === 'no'}
									<Minus class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
								{:else}
									<Check class="mt-0.5 size-3.5 shrink-0 text-primary" />
								{/if}
								<span class={cn(row.ours === 'no' && 'text-muted-foreground')}>{row.us}</span>
							</span>
						</td>
						<td class="px-4 py-3.5 text-muted-foreground">{row.them}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<p class="mt-6 max-w-2xl text-xs leading-relaxed text-muted-foreground">
		The open source ones are worth your time, and they are honest about what they are:
		{#each neighbours as name, i (name)}{i > 0 ? ', ' : ''}{name}{/each}. They triage, summarize and
		draft. None of them read your mail to you, and that is the part Kikitai is built around.
	</p>
</div>
