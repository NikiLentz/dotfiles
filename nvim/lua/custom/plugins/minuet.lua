return {
  'milanglacier/minuet-ai.nvim',
  event = 'InsertEnter',
  dependencies = {
    'nvim-lua/plenary.nvim',
  },
  config = function()
    local model = 'qwen2.5-coder:3b'

    require('minuet').setup {
      provider = 'openai_fim_compatible',
      throttle = 500,
      debounce = 300,
      notify = 'warn',
      provider_options = {
        openai_fim_compatible = {
          api_key = 'TERM',
          name = 'Ollama',
          end_point = 'http://localhost:11434/v1/completions',
          model = model,
          optional = {
            max_tokens = 64,
            top_p = 0.9,
            stop = { '\n' },
          },
        },
      },
      virtualtext = {
        -- Autotriggering follows the nearest .nvim-ai.json below.
        auto_trigger_ft = {},
        keymap = {
          accept = '<C-f>',
          dismiss = '<C-g>',
        },
      },
    }

    -- Set { "enabled": false } in a folder's .nvim-ai.json to disable AI
    -- autocomplete there and in its subfolders. The nearest config wins.
    -- Set enabled to true or remove the file to enable it again.
    local function update_auto_trigger(buf)
      local path = vim.api.nvim_buf_get_name(buf)
      local directory = vim.fn.getcwd()
      if path ~= '' then
        path = vim.uv.fs_realpath(path) or vim.fn.resolve(path)
        directory = vim.fs.dirname(path)
      end
      local config_path = vim.fs.find('.nvim-ai.json', {
        path = directory,
        upward = true,
        type = 'file',
      })[1]
      local enabled = true
      if config_path then
        local ok, config = pcall(function()
          return vim.json.decode(table.concat(vim.fn.readfile(config_path), '\n'))
        end)
        if ok and type(config) == 'table' and type(config.enabled) == 'boolean' then
          enabled = config.enabled
        end
      end
      vim.b[buf].minuet_virtual_text_auto_trigger = enabled
    end

    vim.api.nvim_create_autocmd({ 'FileType', 'BufEnter', 'BufFilePost' }, {
      desc = 'Apply folder AI autocomplete settings from .nvim-ai.json',
      group = vim.api.nvim_create_augroup('minuet-folder-autocomplete', { clear = true }),
      callback = function(args)
        update_auto_trigger(args.buf)
      end,
    })
    for _, buf in ipairs(vim.api.nvim_list_bufs()) do
      update_auto_trigger(buf)
    end

    vim.api.nvim_create_autocmd('VimLeavePre', {
      desc = 'Stop Ollama autocomplete model when last Neovim exits',
      group = vim.api.nvim_create_augroup('ollama-cleanup', { clear = true }),
      callback = function()
        local handle = io.popen('pgrep -c nvim 2>/dev/null')
        if handle then
          local count = tonumber(handle:read '*a') or 0
          handle:close()
          if count <= 1 then
            vim.fn.system('ollama stop ' .. model)
          end
        end
      end,
    })
  end,
}
