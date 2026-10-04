import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'

export default tseslint.config(
    { ignores: ['dist'] },
    {
        files: ['**/*.{ts,tsx}'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
            parserOptions: {
                ecmaVersion: 'latest',
                ecmaFeatures: { jsx: true },
                sourceType: 'module',
            },
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
            'better-tailwindcss': betterTailwindcss,
        },
        settings: {
            'better-tailwindcss': {
                entryPoint: 'src/App.css',
            },
        },
        rules: {
            ...reactHooks.configs.recommended.rules,

            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { args: 'none', varsIgnorePattern: '^[A-Z_]' },
            ],

            '@typescript-eslint/no-explicit-any': 'error',

            '@typescript-eslint/no-non-null-assertion': 'warn',

            'react-refresh/only-export-components': [
                'warn',
                { allowConstantExport: true },
            ],

            'react-hooks/immutability': 'warn',
            'react-hooks/static-components': 'warn',
            'react-hooks/set-state-in-effect': 'warn',
            'no-useless-assignment': 'warn',

            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "CallExpression[callee.name=/Store$/] > ArrowFunctionExpression[body.type='Identifier']",
                    message:
                        'Select the fields you need, or wrap a multi-field selector in useShallow. Returning the whole state re-renders on every change.',
                },
            ],

            'better-tailwindcss/no-unknown-classes': [
                'error',
                {
                    ignore: ['custom-scrollbar', 'gesture-allowed'],
                },
            ],
            'better-tailwindcss/no-conflicting-classes': 'error',
            'better-tailwindcss/no-duplicate-classes': 'error',
            'better-tailwindcss/no-deprecated-classes': 'error',
            'better-tailwindcss/no-unnecessary-whitespace': 'warn',
            'better-tailwindcss/enforce-shorthand-classes': 'warn',
        },
    }
)
