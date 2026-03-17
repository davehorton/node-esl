const promisePlugin = require('eslint-plugin-promise');

module.exports = [
    {
        files: ['lib/**/*.js'],
        plugins: {
            promise: promisePlugin
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'readonly',
                exports: 'readonly',
                process: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
            }
        },
        rules: {
            // Promise rules
            'promise/always-return': 'error',
            'promise/no-return-wrap': 'error',
            'promise/param-names': 'error',
            'promise/catch-or-return': 'error',
            'promise/no-nesting': 'warn',
            'promise/no-promise-in-callback': 'warn',
            'promise/no-callback-in-promise': 'warn',
            'promise/no-return-in-finally': 'warn',

            // Possible Errors
            'comma-dangle': ['error', 'only-multiline'],
            'no-control-regex': 'error',
            'no-debugger': 'error',
            'no-dupe-args': 'error',
            'no-dupe-keys': 'error',
            'no-duplicate-case': 'error',
            'no-empty-character-class': 'error',
            'no-ex-assign': 'error',
            'no-extra-boolean-cast': 'error',
            'no-extra-semi': 'error',
            'no-func-assign': 'error',
            'no-invalid-regexp': 'error',
            'no-irregular-whitespace': 'error',
            'no-unsafe-negation': 'error',
            'no-obj-calls': 'error',
            'no-proto': 'error',
            'no-unexpected-multiline': 'error',
            'no-unreachable': 'error',
            'use-isnan': 'error',
            'valid-typeof': 'error',

            // Best Practices
            'no-fallthrough': 'error',
            'no-octal': 'error',
            'no-redeclare': 'error',
            'no-self-assign': 'error',
            'no-unused-labels': 'error',

            // Strict Mode
            'strict': ['error', 'never'],

            // Variables
            'no-delete-var': 'error',
            'no-undef': 'error',
            'no-unused-vars': ['error', { 'args': 'none' }],

            // Stylistic Issues
            'comma-spacing': 'error',
            'eol-last': 'error',
            'indent': ['error', 4, { 'SwitchCase': 0 }],
            'keyword-spacing': 'error',
            'max-len': ['error', 120, 2],
            'new-parens': 'error',
            'no-mixed-spaces-and-tabs': 'error',
            'no-multiple-empty-lines': ['error', { 'max': 2 }],
            'no-trailing-spaces': ['error', { 'skipBlankLines': false }],
            'quotes': ['error', 'single', 'avoid-escape'],
            'semi': 'error',
            'space-before-blocks': ['error', 'always'],
            'space-before-function-paren': ['error', 'never'],
            'space-in-parens': ['error', 'never'],
            'space-infix-ops': 'error',
            'space-unary-ops': 'error',

            // ECMAScript 6
            'arrow-parens': ['error', 'always'],
            'arrow-spacing': ['error', { 'before': true, 'after': true }],
            'constructor-super': 'error',
            'no-class-assign': 'error',
            'no-confusing-arrow': 'error',
            'no-const-assign': 'error',
            'no-dupe-class-members': 'error',
            'no-new-native-nonconstructor': 'error',
            'no-this-before-super': 'error',
            'prefer-const': 'error'
        }
    }
];
